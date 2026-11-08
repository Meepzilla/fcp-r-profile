// Minimal IndexedDB key-value wrapper. The app database holds two
// records: the data record (plain store JSON or an encrypted vault
// envelope) and a small security meta record (protection mode and
// unlock lockout state). Values are strings.
//
// Every write resolves only after the transaction completes, and the
// persistence layer reads values back before reporting success.

const DB_NAME = 'fcpr-db';
const DB_VERSION = 1;
const STORE_NAME = 'kv';

export const DATA_KEY = 'fcpr-record-v2';
export const META_KEY = 'fcpr-meta-v2';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed.'));
  });
}

function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const request = action(tx.objectStore(STORE_NAME));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
        tx.oncomplete = () => db.close();
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed.'));
      }),
  );
}

export async function idbGet(key: string): Promise<string | null> {
  const value = await run<string | undefined>('readonly', (store) => store.get(key) as IDBRequest<string | undefined>);
  return value ?? null;
}

export async function idbSet(key: string, value: string): Promise<void> {
  await run('readwrite', (store) => store.put(value, key));
}

export async function idbDelete(key: string): Promise<void> {
  await run('readwrite', (store) => store.delete(key));
}
