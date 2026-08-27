import type { KeyValueStore } from './credentials'

/**
 * The one place this app writes to disk.
 *
 * A single object store keyed by string, wrapped in promises. There is no
 * versioned schema: everything kept here is either a credential the user can
 * retype or a journal that describes a run that is over. The one compatibility
 * bridge below preserves those values when the prototype database is upgraded
 * to the public product name.
 *
 * IndexedDB rather than `localStorage` for one reason that is not taste: the
 * push journal is an object graph, and `localStorage` stores strings. Round
 * -tripping it through JSON would work until the first value that does not
 * survive it, which is the kind of bug that shows up months later in someone
 * else's resumed push.
 */

const STORE = 'kv'

function open(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/**
 * One transaction, one operation, and the connection closed after it.
 *
 * Holding a connection open across the life of the tab would block another tab's
 * upgrade and leave this one wedged. These are rare, small operations — a token
 * on connect, a journal line per pushed page — so a connection each is cheap and
 * cannot deadlock anything.
 */
async function withStore<T>(
  dbName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const db = await open(dbName)
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const request = run(tx.objectStore(STORE))
      request.onsuccess = () => resolve(request.result as T)
      request.onerror = () => reject(request.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

// The original prototype used `book2canvas`; the public product name is
// `oer2canvas`. New installs use the public name, while the default store reads
// the two known keys from the old database and removes both copies when the
// user forgets them. Explicit database names remain isolated for tests/tools.
export function createIdbStore(dbName = 'oer2canvas'): KeyValueStore {
  const legacyDbName = dbName === 'oer2canvas' ? 'book2canvas' : undefined
  return {
    get: async (key) => {
      const value = await withStore<unknown>(dbName, 'readonly', (s) => s.get(key))
      if (value !== undefined || legacyDbName === undefined) return value
      return withStore<unknown>(legacyDbName, 'readonly', (s) => s.get(key))
    },
    set: async (key, value) => {
      await withStore(dbName, 'readwrite', (s) => s.put(value, key))
      if (legacyDbName !== undefined) {
        await withStore(legacyDbName, 'readwrite', (s) => s.delete(key))
      }
    },
    remove: async (key) => {
      // Attempt both names even if one database is unavailable. A partially
      // completed deletion is not a safe deletion for a credential key; report
      // the first failure after every known copy has had its best effort.
      const names = legacyDbName === undefined ? [dbName] : [dbName, legacyDbName]
      const results = await Promise.allSettled(
        names.map((name) => withStore(name, 'readwrite', (s) => s.delete(key))),
      )
      const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (failure) throw failure.reason
    },
  }
}
