/** A record that can be synced. Must have an ID and a timestamp for LWW resolution. */
export interface SyncRecord {
  id: string
  updatedAt: string
}

/** Sync engine status. */
export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'error'

/** Listener for sync status changes. */
export type SyncStatusListener = (status: SyncStatus) => void

/** Configuration for the sync engine. */
export interface SyncEngineConfig {
  /** Name for the local IndexedDB store and the remote Drive file. */
  storeName: string
  /** Returns a valid Google OAuth2 access token, or null if not authenticated. */
  getAccessToken: () => string | null
  /** Optional: custom merge function. Defaults to LWW per-record merge. */
  merge?: <T extends SyncRecord>(local: T[], remote: T[]) => T[]
}

/** The document format stored in Google Drive. */
export interface SyncDocument<T extends SyncRecord = SyncRecord> {
  version: 1
  lastModified: string
  records: T[]
}

/** Google Drive file metadata. */
export interface DriveFile {
  id: string
  name: string
  modifiedTime: string
}
