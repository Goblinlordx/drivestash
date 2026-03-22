# drivestash

Offline-first local/cloud sync engine using Google Drive's `appDataFolder`.

Store JSON documents locally (IndexedDB) and sync them to Google Drive's hidden app data folder — zero storage quota cost, user-owned data, works offline.

## Features

- **Offline-first**: Local IndexedDB is the primary store. Works without network.
- **Google Drive appDataFolder**: Hidden per-app folder. No quota cost. User-owned.
- **LWW conflict resolution**: Per-record Last-Write-Wins merge with timestamps.
- **Generic documents**: Sync any JSON-serializable data, not just one schema.
- **Pluggable auth**: Bring your own Google OAuth token provider.
- **Observable sync status**: Subscribe to sync state changes.
- **Auto-sync**: Reconnect, visibility change, and pending queue triggers.

## How It Works

drivestash has four components:

| Component | Role |
|-----------|------|
| **LocalStore** | Wraps IndexedDB directly (zero dependencies). Provides typed CRUD (`get`, `put`, `delete`, `list`, `bulkPut`, `clear`). Each store is a separate IndexedDB table keyed by `id`. |
| **DriveAdapter** | Talks to the Google Drive v3 API. Reads and writes JSON files in the user's `appDataFolder` space. Requires an OAuth2 access token — no built-in auth flow. |
| **lwwMerge** | Default merge strategy. For each record ID, keeps whichever version has the latest `updatedAt` timestamp. Records only on one side are included as-is. Pluggable — you can supply your own merge function. |
| **SyncEngine** | Orchestrates everything. Exposes a simple CRUD + sync API. Manages auto-sync triggers and sync status. Created via `createSyncEngine()`. |

### Sync Flow

Each `sync()` call runs a **pull then push** sequence:

```
Pull:
  1. Find the remote file in appDataFolder (by storeName)
  2. Download its JSON content (a SyncDocument containing all records)
  3. Merge remote records with local records using lwwMerge
  4. Write the merged result back to IndexedDB (bulkPut)

Push:
  1. Read all local records from IndexedDB
  2. Wrap them in a SyncDocument { version: 1, lastModified, records }
  3. Upload to Google Drive (create if first push, update if file exists)
```

After a pull+push cycle, both local and remote have the same set of records.

### Auto-Sync Triggers

The engine automatically syncs in response to browser events:

| Event | Behavior |
|-------|----------|
| `window.online` | Full sync (pull + push) |
| `window.offline` | Status set to `'offline'` — no sync attempted |
| `document.visibilitychange` (visible) | Full sync (pull + push) |
| `engine.put()` / `engine.delete()` | Schedules a push (local write is immediate) |

Multiple sync requests are coalesced — if a sync is already in progress, the next one is queued and runs when the current one finishes. Only one sync runs at a time.

### Status Lifecycle

```
idle ──→ syncing ──→ synced
                  └─→ error

offline (set when browser goes offline)
idle    (restored when browser comes back online, then auto-syncs)
```

Subscribe to status changes with `engine.onStatusChange(listener)`.

## Prerequisites

Before using drivestash, set up a Google Cloud project:

1. **Create a project** in [Google Cloud Console](https://console.cloud.google.com)
2. **Enable the Google Drive API** (APIs & Services > Library > "Google Drive API")
3. **Configure OAuth consent screen** (APIs & Services > OAuth consent screen)
   - Add the scope `https://www.googleapis.com/auth/drive.appdata`
   - This is a restricted scope — for production apps, you'll need Google's verification
4. **Create OAuth2 credentials** (APIs & Services > Credentials > Create > OAuth client ID)
   - Application type: Web application
   - Add your app's origin to "Authorized JavaScript origins"

drivestash does **not** handle the OAuth flow itself. You provide a `getAccessToken` function that returns a valid token. Use whatever auth library fits your stack (e.g., `@react-oauth/google`, `gapi`, `firebase/auth`, or a custom flow).

## Install

```bash
npm install drivestash
```

drivestash has **zero runtime dependencies**. It uses the browser's native IndexedDB API directly.

## Integration Guide

### 1. Define Your Record Type

Every record must extend `SyncRecord` (which requires `id` and `updatedAt`):

```typescript
import type { SyncRecord } from 'drivestash'

interface Bookmark extends SyncRecord {
  url: string
  title: string
  tags: string[]
}
```

### 2. Create a Sync Engine

```typescript
import { createSyncEngine } from 'drivestash'

const engine = createSyncEngine<Bookmark>({
  storeName: 'bookmarks',
  getAccessToken: () => myAuth.getToken(), // return string | null
})
```

The `storeName` is used for both the IndexedDB table name and the Google Drive file name. Each store is independent — create multiple engines for different data types.

### 3. CRUD Operations

All writes go to IndexedDB first (instant, works offline). `put` and `delete` automatically trigger a push to Google Drive in the background.

```typescript
// Create / update
await engine.put({
  id: 'bk-1',
  updatedAt: new Date().toISOString(),
  url: 'https://example.com',
  title: 'Example',
  tags: ['reference'],
})

// Read
const bookmark = await engine.get('bk-1')

// List all
const all = await engine.list()

// Delete
await engine.delete('bk-1')
```

### 4. Manual Sync

```typescript
// Full bidirectional sync (pull remote changes, then push local state)
await engine.sync()

// Pull-only (download and merge remote changes)
await engine.pull()

// Push-only (upload local state to Drive)
await engine.push()
```

### 5. Observe Sync Status

```typescript
const unsubscribe = engine.onStatusChange((status) => {
  // status: 'idle' | 'syncing' | 'synced' | 'offline' | 'error'
  console.log('Sync status:', status)
})

// Later, stop listening
unsubscribe()
```

### 6. Custom Merge Strategy

The default is Last-Write-Wins per record. You can provide your own:

```typescript
import type { MergeFn } from 'drivestash'

const myMerge: MergeFn<Bookmark> = (local, remote) => {
  // Your custom merge logic
  // Return the merged array of records
}

const engine = createSyncEngine<Bookmark>({
  storeName: 'bookmarks',
  getAccessToken: () => myAuth.getToken(),
  merge: myMerge,
})
```

### 7. Payload Compression

drivestash supports optional payload compression to reduce upload/download sizes. The built-in codec uses browser-native `CompressionStream`/`DecompressionStream` (DEFLATE) — zero runtime dependencies.

```typescript
import { createSyncEngine, createDeflateCodec } from 'drivestash'

const engine = createSyncEngine<Bookmark>({
  storeName: 'bookmarks',
  getAccessToken: () => myAuth.getToken(),
  codec: createDeflateCodec(),
})
```

JSON + DEFLATE typically achieves 4-5x size reduction, which is significant since drivestash uploads the full document on every push. You can also provide a custom codec by implementing the `Codec` interface:

```typescript
import type { Codec } from 'drivestash'

const myCodec: Codec = {
  encode(data: string): Promise<ArrayBuffer> { /* ... */ },
  decode(data: ArrayBuffer): Promise<string> { /* ... */ },
}
```

`CompressionStream` is available in Chrome 80+, Firefox 113+, Safari 16.4+.

### 8. Clearing Data on Logout

When a user logs out or switches accounts, clear all local state so the next user doesn't see stale data:

```typescript
async function handleLogout() {
  await engine.clear()
  // Now safe to sign in as a different user
}
```

`clear()` wipes all local records from IndexedDB, resets the cached remote file ID, and sets status to `'idle'`. The engine remains usable — the next `sync()` or `push()` will create a fresh remote file. If the same user logs back in and syncs, their data is restored from Drive.

To also delete the remote Drive file (full wipe):

```typescript
await engine.clearRemote()
```

This is a destructive operation — the remote data cannot be recovered. Use this when a user explicitly requests data deletion, not for routine logout.

### 9. Custom Storage (Dependency Injection)

`createSyncEngine` accepts an optional second argument for injecting custom storage implementations. This is useful for testing (in-memory mocks) or alternative backends:

```typescript
import { createSyncEngine } from 'drivestash'
import type { LocalStorePort, DriveAdapterPort } from 'drivestash'

// In-memory store for testing
const memoryStore: LocalStorePort<MyRecord> = {
  _data: new Map(),
  get(id) { return Promise.resolve(this._data.get(id)) },
  put(record) { this._data.set(record.id, record); return Promise.resolve() },
  delete(id) { this._data.delete(id); return Promise.resolve() },
  list() { return Promise.resolve([...this._data.values()]) },
  bulkPut(records) { for (const r of records) this._data.set(r.id, r); return Promise.resolve() },
  clear() { this._data.clear(); return Promise.resolve() },
}

const engine = createSyncEngine<MyRecord>(
  { storeName: 'test', getAccessToken: () => 'token' },
  { store: memoryStore },
)
```

Both `store` and `drive` can be injected independently. Omitted fields use the default implementations (IndexedDB for store, Google Drive for drive).

### 10. Cleanup

When your component unmounts or the engine is no longer needed:

```typescript
engine.destroy()
```

This removes all browser event listeners (online/offline/visibilitychange) and stops any pending sync operations.

## Good Fit

drivestash works well for:

- **User preferences and settings** — small, infrequently updated, per-user data
- **Bookmarks, favorites, saved items** — append-mostly collections that stay small
- **Stamps and check-ins** — event log style data (visited places, completed tasks)
- **Small note collections** — personal notes, to-do lists, journal entries
- **App state backup** — saving game state, reading progress, or UI configuration
- **PWAs that need cross-device sync** — data follows the user's Google account

The sweet spot is **small-to-medium datasets** (hundreds to low thousands of records) where each record is a small JSON object, writes are infrequent, and only one user owns the data.

## Not a Good Fit

drivestash is **not** designed for:

- **Large datasets** — all records are stored in a single JSON file on Drive. A store with 10,000 records means downloading, parsing, and re-uploading all 10,000 on every sync. There is no pagination or partial sync.
- **High-frequency writes** — every `put()` triggers a push. Rapid writes will queue syncs back-to-back. Consider batching writes and calling `push()` manually if you write frequently.
- **Multi-user or collaborative data** — `appDataFolder` is per-user, per-app. There is no mechanism to share data between users. This is strictly personal data sync.
- **Binary or media files** — drivestash stores JSON only. Images, videos, and other binary data cannot be synced through this library.
- **Data requiring strong consistency** — the sync model is eventually-consistent. Two devices editing the same record simultaneously will resolve via LWW (or your custom merge), but there is no locking or transaction support.

## Risks & Limitations

### Deletions Are Not Propagated

The LWW merge strategy has **no tombstone support**. If you delete a record locally and then sync, the merge will pull the record back from the remote copy:

```
Device A: delete record "x"     → local has no "x"
Device A: sync()
  pull: remote still has "x"    → merge re-adds "x" to local
  push: uploads all records     → "x" is back in remote too
```

**Workaround:** Instead of deleting, add a `deletedAt` field and filter deleted records in your application layer. A future version may add built-in soft-delete support.

### Single-Blob Scaling

Each store maps to **one JSON file** on Google Drive containing all records. As the dataset grows:

- Sync time increases linearly (download → parse → merge → serialize → upload)
- Google Drive file size limits apply (5 MB for `appDataFolder` files is a practical ceiling)
- There is no compaction, pagination, or incremental sync

For a store with 1,000 small records (~100 bytes each), the JSON file is roughly 100 KB — fine. At 10,000 records with 1 KB each, it's 10 MB — too large. Keep stores small and focused.

### No Concurrent-Push Protection

The push operation does **not** use ETags or version checks. If two devices push simultaneously:

```
Device A: push (records: [a, b, c])    ──→ Drive file updated
Device B: push (records: [a, b, d])    ──→ Drive file overwritten
Result: Drive has [a, b, d] — record "c" from Device A is lost
```

The next pull on Device A will restore "c" locally via merge, but the gap between pushes is a window for data loss. In practice, this is rarely an issue for single-user apps with infrequent writes, but it is **not safe for high-concurrency scenarios**.

### Google API Quotas

Google Drive API has [per-user and per-project quotas](https://developers.google.com/drive/api/guides/limits). Each sync makes 1-3 API calls (list + download + upload). At default quotas, you have roughly 12,000 queries per minute per user — more than enough for normal use, but aggressive auto-sync or large numbers of stores could hit limits.

### appDataFolder Scope

- **Per-app, per-user**: Data is scoped to your OAuth client ID and the signed-in Google user. Other apps cannot see it. Other users cannot see it.
- **No user visibility**: Users cannot browse `appDataFolder` contents in Google Drive's UI. If they revoke your app's access, the data is gone.
- **No sharing**: There is no way to share `appDataFolder` data with other users or apps.

## API Reference

### `createSyncEngine<T>(config, options?)`

Creates a sync engine instance. `T` must extend `SyncRecord`.

```typescript
interface SyncEngineConfig {
  storeName: string                                           // IndexedDB table + Drive file name
  getAccessToken: () => string | null                         // OAuth2 token provider
  merge?: <T extends SyncRecord>(local: T[], remote: T[]) => T[]  // Custom merge (default: lwwMerge)
  codec?: Codec                                               // Optional payload compression
}

interface SyncEngineOptions<T extends SyncRecord> {
  store?: LocalStorePort<T>              // Custom local store (default: IndexedDB)
  drive?: DriveAdapterPort               // Custom drive adapter (default: Google Drive)
}

interface SyncEngine<T extends SyncRecord> {
  get(id: string): Promise<T | undefined>
  put(record: T): Promise<void>         // writes locally, triggers push
  delete(id: string): Promise<void>     // deletes locally, triggers push
  list(): Promise<T[]>
  sync(): Promise<void>                 // pull + push
  pull(): Promise<void>                 // download & merge remote
  push(): Promise<void>                 // upload local state
  onStatusChange(listener: SyncStatusListener): () => void
  clear(): Promise<void>               // wipe local data and reset state
  clearRemote(): Promise<void>         // wipe local + delete remote Drive file
  destroy(): void                       // cleanup event listeners
}
```

### `lwwMerge<T>(local, remote)`

Default merge strategy. Keeps the record with the latest `updatedAt` for each `id`. On equal timestamps, local wins.

```typescript
type MergeFn<T extends SyncRecord> = (local: T[], remote: T[]) => T[]
```

### `LocalStore<T>`

Low-level IndexedDB wrapper. Used internally by the sync engine, but also exported for direct use.

```typescript
class LocalStore<T extends SyncRecord> {
  constructor(dbName: string, storeName: string)
  get(id: string): Promise<T | undefined>
  put(record: T): Promise<void>
  delete(id: string): Promise<void>
  list(): Promise<T[]>
  bulkPut(records: T[]): Promise<void>
  clear(): Promise<void>
}
```

### `DriveAdapter`

Low-level Google Drive API client for `appDataFolder`. Used internally, but exported for direct use or testing.

```typescript
class DriveAdapter {
  constructor(getAccessToken: TokenProvider)
  listFiles(name?: string): Promise<DriveFileMeta[]>
  downloadFile<T>(fileId: string): Promise<T>
  createFile<T>(name: string, content: T): Promise<DriveFileMeta>
  updateFile<T>(fileId: string, content: T): Promise<DriveFileMeta>
  deleteFile(fileId: string): Promise<void>
}

class DriveError extends Error {
  readonly status: number
  readonly details: DriveApiErrorDetail[]
}
```

### Types

```typescript
interface SyncRecord {
  id: string
  updatedAt: string   // ISO 8601 timestamp
}

type SyncStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'error'
type SyncStatusListener = (status: SyncStatus) => void
type TokenProvider = () => string | null

interface Codec {
  encode(data: string): Promise<ArrayBuffer>
  decode(data: ArrayBuffer): Promise<string>
}
```

### `createDeflateCodec()`

Creates a codec using browser-native `CompressionStream`/`DecompressionStream` (DEFLATE). Zero dependencies.

## Publishing

Releases are published to npm automatically when a GitHub Release is created:

```bash
npm version patch   # or minor / major
git push --follow-tags
gh release create v0.x.x --generate-notes
```

Creating the GitHub Release triggers the publish workflow, which runs tests, builds, and publishes to npm with provenance.

**Setup:** Add an `NPM_TOKEN` repository secret in GitHub (Settings > Secrets > Actions) with a granular access token that has publish permission for the `drivestash` package.

## License

MIT
