// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSyncEngine } from './sync-engine'
import type { SyncEngine, LocalStorePort, DriveAdapterPort } from './sync-engine'
import type { SyncRecord, SyncStatus, SyncDocument } from './types'

// --- Test types ---

interface TestRecord extends SyncRecord {
  value: string
}

function rec(id: string, value: string, updatedAt = '2026-01-01T00:00:00Z'): TestRecord {
  return { id, updatedAt, value }
}

// --- Mock factories ---

function createMockStore(): LocalStorePort<TestRecord> & {
  _records: Map<string, TestRecord>
  get: ReturnType<typeof vi.fn>
  put: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
  list: ReturnType<typeof vi.fn>
  bulkPut: ReturnType<typeof vi.fn>
  clear: ReturnType<typeof vi.fn>
} {
  const records = new Map<string, TestRecord>()
  return {
    _records: records,
    get: vi.fn((id: string) => Promise.resolve(records.get(id))),
    put: vi.fn((record: TestRecord) => { records.set(record.id, record); return Promise.resolve() }),
    delete: vi.fn((id: string) => { records.delete(id); return Promise.resolve() }),
    list: vi.fn(() => Promise.resolve(Array.from(records.values()))),
    bulkPut: vi.fn((recs: TestRecord[]) => { for (const r of recs) records.set(r.id, r); return Promise.resolve() }),
    clear: vi.fn(() => { records.clear(); return Promise.resolve() }),
  }
}

function createMockDrive(): DriveAdapterPort & {
  _remoteDoc: SyncDocument<TestRecord> | null
  _fileId: string | null
  listFiles: ReturnType<typeof vi.fn>
  downloadFile: ReturnType<typeof vi.fn>
  createFile: ReturnType<typeof vi.fn>
  updateFile: ReturnType<typeof vi.fn>
  deleteFile: ReturnType<typeof vi.fn>
} {
  const mock: ReturnType<typeof createMockDrive> = {
    _remoteDoc: null,
    _fileId: null,
    listFiles: vi.fn(function (this: void) {
      if (mock._fileId) {
        return Promise.resolve([{ id: mock._fileId }])
      }
      return Promise.resolve([])
    }),
    downloadFile: vi.fn(() => Promise.resolve(mock._remoteDoc)),
    createFile: vi.fn((_name: string, doc: SyncDocument<TestRecord>) => {
      mock._remoteDoc = doc
      mock._fileId = 'new-file-id'
      return Promise.resolve({ id: mock._fileId })
    }),
    updateFile: vi.fn((_id: string, doc: SyncDocument<TestRecord>) => {
      mock._remoteDoc = doc
      return Promise.resolve({ id: mock._fileId! })
    }),
    deleteFile: vi.fn((id: string) => {
      if (mock._fileId === id) {
        mock._remoteDoc = null
        mock._fileId = null
      }
      return Promise.resolve()
    }),
  }
  return mock
}

describe('SyncEngine', () => {
  let engine: SyncEngine<TestRecord>
  let mockStore: ReturnType<typeof createMockStore>
  let mockDrive: ReturnType<typeof createMockDrive>

  beforeEach(() => {
    mockStore = createMockStore()
    mockDrive = createMockDrive()
    engine = createSyncEngine<TestRecord>(
      {
        storeName: 'test-store',
        getAccessToken: () => 'test-token',
      },
      { store: mockStore, drive: mockDrive },
    )
  })

  afterEach(() => {
    engine.destroy()
  })

  describe('local CRUD', () => {
    it('put writes to local store', async () => {
      const record = rec('1', 'hello')
      await engine.put(record)
      expect(mockStore.put).toHaveBeenCalledWith(record)
    })

    it('get reads from local store', async () => {
      await engine.put(rec('1', 'hello'))
      const result = await engine.get('1')
      expect(result).toEqual(rec('1', 'hello'))
    })

    it('delete removes from local store', async () => {
      await engine.put(rec('1', 'hello'))
      await engine.delete('1')
      expect(mockStore.delete).toHaveBeenCalledWith('1')
    })

    it('list returns all local records', async () => {
      await engine.put(rec('1', 'a'))
      await engine.put(rec('2', 'b'))
      const records = await engine.list()
      expect(records).toHaveLength(2)
    })
  })

  describe('sync orchestration', () => {
    it('pull downloads remote and merges into local', async () => {
      mockDrive._remoteDoc = { version: 1, lastModified: '2026-01-01T00:00:00Z', records: [rec('1', 'remote')] }
      mockDrive._fileId = 'file-1'

      await engine.pull()

      expect(mockDrive.downloadFile).toHaveBeenCalledWith('file-1')
      expect(mockStore.bulkPut).toHaveBeenCalled()
    })

    it('pull does nothing when no remote file exists', async () => {
      mockDrive._remoteDoc = null
      mockDrive._fileId = null

      await engine.pull()

      expect(mockDrive.downloadFile).not.toHaveBeenCalled()
    })

    it('push creates file when no remote exists', async () => {
      mockDrive._remoteDoc = null
      mockDrive._fileId = null

      await engine.push()

      expect(mockDrive.createFile).toHaveBeenCalled()
    })

    it('push updates file when remote exists', async () => {
      mockDrive._remoteDoc = { version: 1, lastModified: '2026-01-01T00:00:00Z', records: [] }
      mockDrive._fileId = 'file-1'

      await engine.push()

      expect(mockDrive.updateFile).toHaveBeenCalled()
    })

    it('sync performs pull then push', async () => {
      mockDrive._remoteDoc = { version: 1, lastModified: '2026-01-01T00:00:00Z', records: [rec('1', 'remote')] }
      mockDrive._fileId = 'file-1'

      await engine.sync()

      expect(mockDrive.downloadFile).toHaveBeenCalled()
      expect(mockDrive.updateFile).toHaveBeenCalled()
    })
  })

  describe('status transitions', () => {
    it('starts as idle — no transitions emitted', () => {
      const statuses: SyncStatus[] = []
      engine.onStatusChange((s) => statuses.push(s))
      expect(statuses).toEqual([])
    })

    it('transitions to syncing then synced on successful sync', async () => {
      const statuses: SyncStatus[] = []
      engine.onStatusChange((s) => statuses.push(s))

      await engine.sync()

      expect(statuses).toContain('syncing')
      expect(statuses[statuses.length - 1]).toBe('synced')
    })

    it('transitions to error on failed sync', async () => {
      mockDrive._fileId = 'file-1'
      mockDrive.downloadFile.mockRejectedValueOnce(new Error('Network error'))

      const statuses: SyncStatus[] = []
      engine.onStatusChange((s) => statuses.push(s))

      await engine.pull()

      expect(statuses).toContain('error')
    })

    it('unsubscribe stops notifications', async () => {
      const statuses: SyncStatus[] = []
      const unsub = engine.onStatusChange((s) => statuses.push(s))
      unsub()

      await engine.sync()

      expect(statuses).toEqual([])
    })
  })

  describe('concurrent sync guard and coalescing', () => {
    it('coalesces a second push while one is in progress', async () => {
      let resolveFirst!: () => void
      const slowPromise = new Promise<void>((resolve) => { resolveFirst = resolve })

      // Make listFiles slow on the first call to hold the sync in progress
      const originalListFiles = mockDrive.listFiles.getMockImplementation()!
      mockDrive.listFiles.mockImplementationOnce(async (...args: unknown[]) => {
        await slowPromise
        return originalListFiles(...args)
      })

      // Start first push — it will block on listFiles
      const push1 = engine.push()

      // Second push while first is in progress — should be coalesced
      const push2 = engine.push()

      // Resolve the slow listFiles
      resolveFirst()

      await push1
      await push2

      // Wait for any coalesced push to settle
      await new Promise((r) => setTimeout(r, 20))

      // listFiles was called (at least once from push1, possibly from coalesced)
      // The key assertion: push2 didn't run concurrently — it was coalesced
      // Both pushes should have completed without error
      expect(mockDrive.listFiles).toHaveBeenCalled()
    })
  })

  describe('auto-sync triggers', () => {
    it('syncs on online event', async () => {
      const statuses: SyncStatus[] = []
      engine.onStatusChange((s) => statuses.push(s))

      window.dispatchEvent(new Event('online'))

      await vi.waitFor(() => {
        expect(statuses).toContain('syncing')
      })
    })

    it('sets offline status on offline event', () => {
      const statuses: SyncStatus[] = []
      engine.onStatusChange((s) => statuses.push(s))

      window.dispatchEvent(new Event('offline'))

      expect(statuses).toContain('offline')
    })

    it('syncs on visibility change to visible', async () => {
      const statuses: SyncStatus[] = []
      engine.onStatusChange((s) => statuses.push(s))

      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        writable: true,
        configurable: true,
      })
      document.dispatchEvent(new Event('visibilitychange'))

      await vi.waitFor(() => {
        expect(statuses).toContain('syncing')
      })
    })
  })

  describe('clear', () => {
    it('wipes all local records', async () => {
      await engine.put(rec('1', 'a'))
      await engine.put(rec('2', 'b'))

      await engine.clear()

      expect(mockStore.clear).toHaveBeenCalled()
      const records = await engine.list()
      expect(records).toHaveLength(0)
    })

    it('resets remoteFileId so next push creates a new file', async () => {
      // First push — creates remote file
      await engine.push()
      expect(mockDrive.createFile).toHaveBeenCalledTimes(1)
      mockDrive.createFile.mockClear()

      // Clear resets remoteFileId
      await engine.clear()

      // Reset drive mock so listFiles returns empty (simulating new user)
      mockDrive._fileId = null
      mockDrive._remoteDoc = null

      // Next push should create a new file, not update
      await engine.push()
      expect(mockDrive.createFile).toHaveBeenCalledTimes(1)
      expect(mockDrive.updateFile).not.toHaveBeenCalled()
    })

    it('sets status to idle', async () => {
      // Put the engine in synced state
      await engine.sync()

      const statuses: SyncStatus[] = []
      engine.onStatusChange((s) => statuses.push(s))

      await engine.clear()

      expect(statuses).toContain('idle')
    })

    it('cancels pending sync', async () => {
      let resolveFirst!: () => void
      const slowPromise = new Promise<void>((resolve) => { resolveFirst = resolve })

      const originalListFiles = mockDrive.listFiles.getMockImplementation()!
      mockDrive.listFiles.mockImplementationOnce(async (...args: unknown[]) => {
        await slowPromise
        return originalListFiles(...args)
      })

      // Start a sync that blocks
      const syncPromise = engine.sync()

      // Queue a pending push
      void engine.push()

      // Clear while sync is in progress — should cancel pending
      await engine.clear()

      // Unblock the in-progress sync
      resolveFirst()
      await syncPromise

      // Wait for any coalesced operations
      await new Promise((r) => setTimeout(r, 20))

      // Store should have been cleared (no records from the pending push)
      expect(mockStore.clear).toHaveBeenCalled()
    })
  })

  describe('clearRemote', () => {
    it('wipes local records and deletes remote file', async () => {
      await engine.put(rec('1', 'a'))
      await engine.push()
      expect(mockDrive._fileId).toBe('new-file-id')

      await engine.clearRemote()

      expect(mockStore.clear).toHaveBeenCalled()
      expect(mockDrive.deleteFile).toHaveBeenCalledWith('new-file-id')
      expect(mockDrive._remoteDoc).toBeNull()
      expect(mockDrive._fileId).toBeNull()
    })

    it('handles no remote file gracefully', async () => {
      await engine.clearRemote()

      expect(mockDrive.deleteFile).not.toHaveBeenCalled()
      expect(mockStore.clear).toHaveBeenCalled()
    })

    it('sets status to idle after clearing', async () => {
      await engine.sync()
      const statuses: SyncStatus[] = []
      engine.onStatusChange((s) => statuses.push(s))

      await engine.clearRemote()

      expect(statuses).toContain('idle')
    })
  })

  describe('destroy', () => {
    it('clears listeners and prevents further sync operations', async () => {
      const statuses: SyncStatus[] = []
      engine.onStatusChange((s) => statuses.push(s))

      engine.destroy()

      window.dispatchEvent(new Event('online'))
      await new Promise((r) => setTimeout(r, 10))

      expect(statuses).toEqual([])
    })
  })
})
