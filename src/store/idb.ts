// Minimal IndexedDB key-value persistence (no size cap like localStorage). Replaced by Supabase later.
const open = () => new Promise<IDBDatabase>((res, rej) => {
  const r = indexedDB.open('academy-erp', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
export async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await open();
  return new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(key); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
}
export async function idbSet(key: string, value: unknown) {
  const db = await open();
  return new Promise<void>((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(value, key); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
}
