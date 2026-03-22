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

## Install

```bash
npm install drivestash
```

## Quick Start

```typescript
import { createSyncEngine } from 'drivestash'

const engine = createSyncEngine({
  storeName: 'my-app-data',
  getAccessToken: () => myAuthProvider.getToken(),
})

// Write locally (instant, works offline)
await engine.put('item-1', { name: 'Example', updatedAt: new Date().toISOString() })

// Sync with Google Drive
await engine.sync()

// Read
const item = await engine.get('item-1')
```

## Publishing

Releases are published to npm automatically when a version tag is pushed:

```bash
npm version patch   # or minor / major
git push --follow-tags
```

**Setup:** Add an `NPM_TOKEN` repository secret in GitHub (Settings > Secrets > Actions) with a granular access token that has publish permission for the `drivestash` package.

## License

MIT
