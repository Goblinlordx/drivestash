import Dexie, { type Table } from 'dexie'
import type { SyncRecord } from './types'

export class LocalStore<T extends SyncRecord> {
  private db: Dexie
  private table: Table<T, string>

  constructor(dbName: string, storeName: string) {
    this.db = new Dexie(dbName)
    this.db.version(1).stores({ [storeName]: 'id' })
    this.table = this.db.table(storeName)
  }

  async get(id: string): Promise<T | undefined> {
    return this.table.get(id)
  }

  async put(record: T): Promise<void> {
    await this.table.put(record)
  }

  async delete(id: string): Promise<void> {
    await this.table.delete(id)
  }

  async list(): Promise<T[]> {
    return this.table.toArray()
  }

  async bulkPut(records: T[]): Promise<void> {
    await this.table.bulkPut(records)
  }

  async clear(): Promise<void> {
    await this.table.clear()
  }
}
