// IndexedDB store for the signed-in technician's last synchronised data. One snapshot per user id.
// Everything here is wiped on sign-out and when a different account signs in. All functions fail soft (private mode etc.).
const DB = 'ahba-portal', VER = 1;
let dbp;
const open = () => (dbp ??= new Promise((res, rej) => {
  if (typeof indexedDB === 'undefined') return rej(new Error('IndexedDB unavailable'));
  const r = indexedDB.open(DB, VER);
  r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('snapshot', { keyPath: 'uid' }); d.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true }); };
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
}));
const run = async (store, mode, fn) => {
  const db = await open();
  return new Promise((res, rej) => { const t = db.transaction(store, mode), s = t.objectStore(store), r = fn(s); t.oncomplete = () => res(r?.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
};
const soft = (p, fallback = null) => p.catch(() => fallback);

export const saveSnapshot = (uid, data, savedAt = Date.now()) => soft(run('snapshot', 'readwrite', (s) => s.put({ uid, savedAt, data })));
export const loadSnapshot = (uid) => soft(run('snapshot', 'readonly', (s) => s.get(uid)));
export const clearForUser = (uid) => soft(run('snapshot', 'readwrite', (s) => s.delete(uid)));
export const clearAllData = async () => { await soft(run('snapshot', 'readwrite', (s) => s.clear())); await soft(run('outbox', 'readwrite', (s) => s.clear())); };
export async function purgeOthers(uid) {
  await soft(run('snapshot', 'readwrite', (s) => { s.openCursor().onsuccess = (e) => { const c = e.target.result; if (c) { if (c.value.uid !== uid) c.delete(); c.continue(); } }; return null; }));
  await soft(run('outbox', 'readwrite', (s) => { s.openCursor().onsuccess = (e) => { const c = e.target.result; if (c) { if (c.value.uid !== uid) c.delete(); c.continue(); } }; return null; }));
}
// Safe-to-replay actions only (marking notifications read).
export const queueOp = (uid, op) => soft(run('outbox', 'readwrite', (s) => s.add({ uid, ...op, at: Date.now() })));
export const listOps = (uid) => soft(run('outbox', 'readonly', (s) => s.getAll()), []).then((all) => (all || []).filter((o) => o.uid === uid));
export const removeOp = (id) => soft(run('outbox', 'readwrite', (s) => s.delete(id)));
