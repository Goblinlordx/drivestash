import type { SyncRecord } from './types'

/** Merge function signature: takes local and remote records, returns merged result. */
export type MergeFn<T extends SyncRecord> = (local: T[], remote: T[]) => T[]

/**
 * Default Last-Write-Wins merge strategy.
 *
 * For each record ID present in either array, keeps the version with the
 * latest `updatedAt` timestamp. Records that exist in only one side are
 * included as-is.
 */
export function lwwMerge<T extends SyncRecord>(local: T[], remote: T[]): T[] {
  const merged = new Map<string, T>()

  for (const record of local) {
    merged.set(record.id, record)
  }

  for (const record of remote) {
    const existing = merged.get(record.id)
    if (!existing || record.updatedAt > existing.updatedAt) {
      merged.set(record.id, record)
    }
  }

  return Array.from(merged.values())
}
