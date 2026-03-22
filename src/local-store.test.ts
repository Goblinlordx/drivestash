import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { LocalStore } from './local-store'
import type { SyncRecord } from './types'

interface TestRecord extends SyncRecord {
  name: string
}

describe('LocalStore', () => {
  let store: LocalStore<TestRecord>
  let dbCounter = 0

  beforeEach(() => {
    // Use a unique DB name per test to avoid state leakage
    store = new LocalStore<TestRecord>(`test-db-${++dbCounter}`, 'records')
  })

  it('returns undefined for missing record', async () => {
    expect(await store.get('nonexistent')).toBeUndefined()
  })

  it('puts and gets a record', async () => {
    const record: TestRecord = { id: '1', updatedAt: '2026-01-01T00:00:00Z', name: 'Alice' }
    await store.put(record)
    expect(await store.get('1')).toEqual(record)
  })

  it('upserts an existing record', async () => {
    await store.put({ id: '1', updatedAt: '2026-01-01T00:00:00Z', name: 'Alice' })
    await store.put({ id: '1', updatedAt: '2026-01-02T00:00:00Z', name: 'Alice Updated' })
    const result = await store.get('1')
    expect(result?.name).toBe('Alice Updated')
    expect(result?.updatedAt).toBe('2026-01-02T00:00:00Z')
  })

  it('deletes a record', async () => {
    await store.put({ id: '1', updatedAt: '2026-01-01T00:00:00Z', name: 'Alice' })
    await store.delete('1')
    expect(await store.get('1')).toBeUndefined()
  })

  it('delete on missing id is a no-op', async () => {
    await expect(store.delete('nonexistent')).resolves.toBeUndefined()
  })

  it('lists all records', async () => {
    await store.put({ id: '1', updatedAt: '2026-01-01T00:00:00Z', name: 'Alice' })
    await store.put({ id: '2', updatedAt: '2026-01-01T00:00:00Z', name: 'Bob' })
    const records = await store.list()
    expect(records).toHaveLength(2)
    expect(records.map((r) => r.id).sort()).toEqual(['1', '2'])
  })

  it('returns empty array when no records exist', async () => {
    expect(await store.list()).toEqual([])
  })

  it('bulkPuts multiple records', async () => {
    const records: TestRecord[] = [
      { id: '1', updatedAt: '2026-01-01T00:00:00Z', name: 'Alice' },
      { id: '2', updatedAt: '2026-01-01T00:00:00Z', name: 'Bob' },
      { id: '3', updatedAt: '2026-01-01T00:00:00Z', name: 'Charlie' },
    ]
    await store.bulkPut(records)
    expect(await store.list()).toHaveLength(3)
  })

  it('bulkPut upserts existing records', async () => {
    await store.put({ id: '1', updatedAt: '2026-01-01T00:00:00Z', name: 'Alice' })
    await store.bulkPut([
      { id: '1', updatedAt: '2026-01-02T00:00:00Z', name: 'Alice Updated' },
      { id: '2', updatedAt: '2026-01-01T00:00:00Z', name: 'Bob' },
    ])
    expect(await store.list()).toHaveLength(2)
    expect((await store.get('1'))?.name).toBe('Alice Updated')
  })

  it('clears all records', async () => {
    await store.bulkPut([
      { id: '1', updatedAt: '2026-01-01T00:00:00Z', name: 'Alice' },
      { id: '2', updatedAt: '2026-01-01T00:00:00Z', name: 'Bob' },
    ])
    await store.clear()
    expect(await store.list()).toEqual([])
  })

  it('preserves generic type parameter fields', async () => {
    const record: TestRecord = { id: '1', updatedAt: '2026-01-01T00:00:00Z', name: 'Alice' }
    await store.put(record)
    const result = await store.get('1')
    // Verify the custom field is preserved and typed
    expect(result?.name).toBe('Alice')
  })

  it('works with different SyncRecord subtypes', async () => {
    interface TagRecord extends SyncRecord {
      label: string
      color: string
    }
    const tagStore = new LocalStore<TagRecord>(`test-db-${++dbCounter}`, 'tags')
    await tagStore.put({ id: 't1', updatedAt: '2026-01-01T00:00:00Z', label: 'urgent', color: 'red' })
    const tag = await tagStore.get('t1')
    expect(tag?.label).toBe('urgent')
    expect(tag?.color).toBe('red')
  })
})
