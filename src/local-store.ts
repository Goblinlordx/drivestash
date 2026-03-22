import type { SyncRecord } from './types'

function openDatabase(dbName: string, storeName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export class LocalStore<T extends SyncRecord> {
  private dbPromise: Promise<IDBDatabase>
  private storeName: string

  constructor(dbName: string, storeName: string) {
    this.storeName = storeName
    this.dbPromise = openDatabase(dbName, storeName)
  }

  private async store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const db = await this.dbPromise
    return db.transaction(this.storeName, mode).objectStore(this.storeName)
  }

  async get(id: string): Promise<T | undefined> {
    const store = await this.store('readonly')
    const result = await idbRequest<T | undefined>(store.get(id))
    return result ?? undefined
  }

  async put(record: T): Promise<void> {
    const store = await this.store('readwrite')
    await idbRequest(store.put(record))
  }

  async delete(id: string): Promise<void> {
    const store = await this.store('readwrite')
    await idbRequest(store.delete(id))
  }

  async list(): Promise<T[]> {
    const store = await this.store('readonly')
    return idbRequest(store.getAll())
  }

  async bulkPut(records: T[]): Promise<void> {
    const db = await this.dbPromise
    const tx = db.transaction(this.storeName, 'readwrite')
    const store = tx.objectStore(this.storeName)
    for (const record of records) {
      store.put(record)
    }
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  async clear(): Promise<void> {
    const store = await this.store('readwrite')
    await idbRequest(store.clear())
  }
}
