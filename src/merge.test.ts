import { describe, it, expect } from 'vitest'
import { lwwMerge } from './merge'
import type { SyncRecord } from './types'

interface TestRecord extends SyncRecord {
  value: string
}

function rec(id: string, updatedAt: string, value: string): TestRecord {
  return { id, updatedAt, value }
}

describe('lwwMerge', () => {
  it('keeps local record when local is newer', () => {
    const local = [rec('1', '2026-01-02T00:00:00Z', 'local')]
    const remote = [rec('1', '2026-01-01T00:00:00Z', 'remote')]

    const result = lwwMerge(local, remote)
    expect(result).toEqual([rec('1', '2026-01-02T00:00:00Z', 'local')])
  })

  it('keeps remote record when remote is newer', () => {
    const local = [rec('1', '2026-01-01T00:00:00Z', 'local')]
    const remote = [rec('1', '2026-01-02T00:00:00Z', 'remote')]

    const result = lwwMerge(local, remote)
    expect(result).toEqual([rec('1', '2026-01-02T00:00:00Z', 'remote')])
  })

  it('includes new records from both sides', () => {
    const local = [rec('1', '2026-01-01T00:00:00Z', 'local-only')]
    const remote = [rec('2', '2026-01-01T00:00:00Z', 'remote-only')]

    const result = lwwMerge(local, remote)
    expect(result).toHaveLength(2)
    expect(result).toContainEqual(rec('1', '2026-01-01T00:00:00Z', 'local-only'))
    expect(result).toContainEqual(rec('2', '2026-01-01T00:00:00Z', 'remote-only'))
  })

  it('handles empty local array', () => {
    const remote = [rec('1', '2026-01-01T00:00:00Z', 'remote')]
    const result = lwwMerge([], remote)
    expect(result).toEqual([rec('1', '2026-01-01T00:00:00Z', 'remote')])
  })

  it('handles empty remote array', () => {
    const local = [rec('1', '2026-01-01T00:00:00Z', 'local')]
    const result = lwwMerge(local, [])
    expect(result).toEqual([rec('1', '2026-01-01T00:00:00Z', 'local')])
  })

  it('handles both arrays empty', () => {
    const result = lwwMerge([], [])
    expect(result).toEqual([])
  })

  it('keeps local when timestamps are equal', () => {
    const local = [rec('1', '2026-01-01T00:00:00Z', 'local')]
    const remote = [rec('1', '2026-01-01T00:00:00Z', 'remote')]

    const result = lwwMerge(local, remote)
    // Equal timestamps: local was set first in the map, remote doesn't win (not >)
    expect(result).toEqual([rec('1', '2026-01-01T00:00:00Z', 'local')])
  })

  it('merges multiple records correctly', () => {
    const local = [
      rec('1', '2026-01-02T00:00:00Z', 'local-1-newer'),
      rec('2', '2026-01-01T00:00:00Z', 'local-2-older'),
      rec('3', '2026-01-01T00:00:00Z', 'local-only'),
    ]
    const remote = [
      rec('1', '2026-01-01T00:00:00Z', 'remote-1-older'),
      rec('2', '2026-01-02T00:00:00Z', 'remote-2-newer'),
      rec('4', '2026-01-01T00:00:00Z', 'remote-only'),
    ]

    const result = lwwMerge(local, remote)
    expect(result).toHaveLength(4)
    expect(result).toContainEqual(rec('1', '2026-01-02T00:00:00Z', 'local-1-newer'))
    expect(result).toContainEqual(rec('2', '2026-01-02T00:00:00Z', 'remote-2-newer'))
    expect(result).toContainEqual(rec('3', '2026-01-01T00:00:00Z', 'local-only'))
    expect(result).toContainEqual(rec('4', '2026-01-01T00:00:00Z', 'remote-only'))
  })
})
