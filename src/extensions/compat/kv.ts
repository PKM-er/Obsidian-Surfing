// Private key-value store for compat-layer state, in the extension origin's
// IndexedDB. Unlike chrome.storage it never shows up in the extension's own
// storage listings. Falls back to memory where IndexedDB is unavailable.

const DB = '__obsidian_bridge';
const STORE = 'kv';

export interface KV {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  readonly persistent: boolean;
}

export function createKV(): KV {
  const idb: IDBFactory | undefined = typeof indexedDB === 'object' ? indexedDB : undefined;
  if (!idb) {
    const memory = new Map<string, unknown>();
    return {
      persistent: false,
      get: async <T>(key: string) => memory.get(key) as T | undefined,
      set: async (key, value) => { memory.set(key, structuredClone(value)); }
    };
  }
  let db: Promise<IDBDatabase> | null = null;
  const open = () => db ??= new Promise((resolve, reject) => {
    const request = idb.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { db = null; reject(request.error ?? new Error('IndexedDB open failed')); };
  });
  const run = <T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> =>
    open().then(database => new Promise<T>((resolve, reject) => {
      const request = fn(database.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
    }));
  return {
    persistent: true,
    get: <T>(key: string) => run<T | undefined>('readonly', store => store.get(key)),
    set: (key, value) => run<void>('readwrite', store => store.put(value, key)).then(() => undefined)
  };
}
