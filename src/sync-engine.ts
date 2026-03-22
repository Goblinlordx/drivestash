import type { SyncRecord, SyncStatus, SyncStatusListener, SyncEngineConfig, SyncDocument } from './types'
import { LocalStore } from './local-store'
import { DriveAdapter } from './drive-adapter'
import { lwwMerge } from './merge'
import type { MergeFn } from './merge'

/** Minimal interface for the local store dependency. */
export interface LocalStorePort<T extends SyncRecord> {
  get(id: string): Promise<T | undefined>
  put(record: T): Promise<void>
  delete(id: string): Promise<void>
  list(): Promise<T[]>
  bulkPut(records: T[]): Promise<void>
  clear(): Promise<void>
}

/** Minimal interface for the drive adapter dependency. */
export interface DriveAdapterPort {
  listFiles(name?: string): Promise<Array<{ id: string }>>
  downloadFile<U>(fileId: string): Promise<U>
  createFile<U>(name: string, content: U): Promise<{ id: string }>
  updateFile<U>(fileId: string, content: U): Promise<{ id: string }>
  deleteFile(fileId: string): Promise<void>
}

/** Public API returned by createSyncEngine. */
export interface SyncEngine<T extends SyncRecord> {
  get(id: string): Promise<T | undefined>
  put(record: T): Promise<void>
  delete(id: string): Promise<void>
  list(): Promise<T[]>
  sync(): Promise<void>
  pull(): Promise<void>
  push(): Promise<void>
  onStatusChange(listener: SyncStatusListener): () => void
  clear(): Promise<void>
  clearRemote(): Promise<void>
  destroy(): void
}

/** Internal options for dependency injection (testing). */
interface InternalOptions<T extends SyncRecord> {
  store?: LocalStorePort<T>
  drive?: DriveAdapterPort
}

/**
 * Creates a sync engine that orchestrates bidirectional sync between
 * a local IndexedDB store and Google Drive's appDataFolder.
 *
 * One engine instance manages one document (identified by storeName).
 */
export function createSyncEngine<T extends SyncRecord>(
  config: SyncEngineConfig,
  _internal?: InternalOptions<T>,
): SyncEngine<T> {
  const { storeName, getAccessToken } = config
  const merge: MergeFn<T> = (config.merge as MergeFn<T> | undefined) ?? lwwMerge
  const store: LocalStorePort<T> = _internal?.store ?? new LocalStore<T>(`drivestash-${storeName}`, storeName)
  const drive: DriveAdapterPort = _internal?.drive ?? new DriveAdapter(getAccessToken)

  let status: SyncStatus = 'idle'
  const listeners = new Set<SyncStatusListener>()
  let syncInProgress = false
  let pendingSync = false
  let remoteFileId: string | null = null
  let destroyed = false

  // --- Cleanup tracking ---
  const cleanupFns: Array<() => void> = []

  // --- Status management ---

  function setStatus(next: SyncStatus): void {
    if (next !== status) {
      status = next
      for (const listener of listeners) {
        listener(status)
      }
    }
  }

  // --- Remote file ID resolution ---

  async function resolveFileId(): Promise<string | null> {
    if (remoteFileId !== null) return remoteFileId
    const files = await drive.listFiles(storeName)
    if (files.length > 0) {
      remoteFileId = files[0].id
    }
    return remoteFileId
  }

  // --- Sync operations ---

  async function pullImpl(): Promise<void> {
    const fileId = await resolveFileId()
    if (fileId === null) return // No remote file yet — nothing to pull

    const doc = await drive.downloadFile<SyncDocument<T>>(fileId)
    const local = await store.list()
    const merged = merge(local, doc.records)
    await store.bulkPut(merged)
  }

  async function pushImpl(): Promise<void> {
    const records = await store.list()
    const doc: SyncDocument<T> = {
      version: 1,
      lastModified: new Date().toISOString(),
      records,
    }

    const fileId = await resolveFileId()
    if (fileId === null) {
      const created = await drive.createFile(storeName, doc)
      remoteFileId = created.id
    } else {
      await drive.updateFile(fileId, doc)
    }
  }

  async function syncImpl(): Promise<void> {
    await pullImpl()
    await pushImpl()
  }

  async function runSync(fn: () => Promise<void>): Promise<void> {
    if (destroyed) return
    if (syncInProgress) {
      pendingSync = true
      return
    }
    syncInProgress = true
    setStatus('syncing')
    try {
      await fn()
      setStatus('synced')
    } catch {
      setStatus('error')
    } finally {
      syncInProgress = false
      if (pendingSync) {
        pendingSync = false
        void runSync(syncImpl)
      }
    }
  }

  function schedulePush(): void {
    void runSync(pushImpl)
  }

  // --- Auto-sync listeners ---

  function handleOnline(): void {
    setStatus('idle')
    void runSync(syncImpl)
  }

  function handleOffline(): void {
    setStatus('offline')
  }

  function handleVisibility(): void {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      void runSync(syncImpl)
    }
  }

  // Register browser listeners if available
  if (typeof window !== 'undefined') {
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    cleanupFns.push(() => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    })
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibility)
    cleanupFns.push(() => {
      document.removeEventListener('visibilitychange', handleVisibility)
    })
  }

  // Set initial status based on network state
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    status = 'offline'
  }

  // --- Public API ---

  return {
    async get(id: string): Promise<T | undefined> {
      return store.get(id)
    },

    async put(record: T): Promise<void> {
      await store.put(record)
      schedulePush()
    },

    async delete(id: string): Promise<void> {
      await store.delete(id)
      schedulePush()
    },

    async list(): Promise<T[]> {
      return store.list()
    },

    async sync(): Promise<void> {
      return runSync(syncImpl)
    },

    async pull(): Promise<void> {
      return runSync(pullImpl)
    },

    async push(): Promise<void> {
      return runSync(pushImpl)
    },

    onStatusChange(listener: SyncStatusListener): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    async clear(): Promise<void> {
      pendingSync = false
      await store.clear()
      remoteFileId = null
      setStatus('idle')
    },

    async clearRemote(): Promise<void> {
      pendingSync = false
      await store.clear()
      const fileId = await resolveFileId()
      if (fileId !== null) {
        await drive.deleteFile(fileId)
      }
      remoteFileId = null
      setStatus('idle')
    },

    destroy(): void {
      destroyed = true
      listeners.clear()
      for (const cleanup of cleanupFns) {
        cleanup()
      }
      cleanupFns.length = 0
    },
  }
}
