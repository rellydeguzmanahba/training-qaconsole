import * as defaultStore from '../pwa/offline-store.js';

// Single data entry point for the technician portal: live when online, last snapshot when the network fails.
// Authorization errors are never answered from the cache (a revoked account must not keep seeing old data).
export const isNetworkError = (e) => (typeof navigator !== 'undefined' && navigator.onLine === false)
  || /Failed to fetch|NetworkError|Load failed|network request failed/i.test(String(e?.message || ''));
const optionalMissing = (e) => ['PGRST205', 'PGRST202', '42P01'].includes(e?.code) || /does not exist|Could not find/i.test(e?.message || '');

async function fetchLive(sb) {
  const q = await Promise.all([
    sb.from('v_my_profile').select('*').maybeSingle(),
    sb.from('v_my_violations').select('*').order('violation_date', { ascending: false }).order('id'),
    sb.from('v_my_evidence').select('id,violation_id,file_name,kind,external_url,storage_path'),
    sb.rpc('my_monitoring'), sb.rpc('my_penalties'),
    sb.from('v_my_retrainings').select('*').order('created_at', { ascending: false }),
    sb.from('v_my_notifications').select('*').order('created_at', { ascending: false }).limit(50),   // optional (migration 012)
    sb.from('v_my_training').select('*').order('name'), // optional until migration 013
  ]);
  const bad = q.slice(0, 6).find((r) => r.error)?.error;
  if (bad) { const e = new Error(bad.message); e.code = bad.code; e.network = isNetworkError(bad); throw e; }
  const note = q[6], training = q[7];
  if (training.error && !optionalMissing(training.error)) { const e = new Error(training.error.message); e.code = training.error.code; throw e; }
  if (note.error && !optionalMissing(note.error)) { const e = new Error(note.error.message); e.code = note.error.code; e.network = isNetworkError(note.error); throw e; }
  return { profile: q[0].data, violations: q[1].data, evidence: q[2].data, monitoring: q[3].data?.[0] ?? null, penalties: q[4].data,
    retrainings: q[5].data, notifications: note.error ? null : note.data, training: training.error ? null : training.data };
}

// Evidence file paths / links are not kept offline (files cannot be opened without a connection anyway).
const forStorage = (d) => ({ ...d, evidence: d.evidence.map(({ id, violation_id, file_name, kind }) => ({ id, violation_id, file_name, kind })) });

export async function loadWithFallback({ fetchFn, store = defaultStore, uid, now = Date.now }) {
  try {
    const live = await fetchFn();
    const syncedAt = now();
    if (!live.profile) await store.clearForUser(uid);               // unlinked / deactivated: drop any stale copy
    else await store.saveSnapshot(uid, forStorage(live), syncedAt);
    return { ...live, source: 'live', syncedAt };
  } catch (e) {
    if (!(e.network || isNetworkError(e))) throw e;
    const snap = await store.loadSnapshot(uid);
    if (!snap) throw e;
    return { ...snap.data, source: 'cache', syncedAt: snap.savedAt };
  }
}

let memo = null;
export const resetPortalCache = () => { memo = null; };
export function getPortal(ctx) {
  const uid = ctx.profile.user_id;
  if (memo && memo.uid === uid && Date.now() - memo.at < 8000) return memo.promise;       // de-duplicate bursts (tab switches)
  const promise = loadWithFallback({ fetchFn: () => fetchLive(ctx.sb), uid });
  memo = { uid, at: Date.now(), promise };
  promise.catch(() => { if (memo?.promise === promise) memo = null; });
  return promise;
}

// Marking notifications read: online -> now; offline -> queued and replayed later (safe, idempotent).
export async function markRead(ctx, ids, store = defaultStore) {
  if (!ids.length) return;
  const uid = ctx.profile.user_id;
  if (navigator.onLine !== false) {
    const { error } = await ctx.sb.rpc('mark_notifications_read', { p_ids: ids });
    if (!error) return;
    if (!isNetworkError(error)) return;                              // e.g. migration missing: keep local state only
  }
  await store.queueOp(uid, { type: 'mark_read', ids });
}
export async function flushOutbox(ctx, store = defaultStore) {
  const uid = ctx.profile.user_id, ops = await store.listOps(uid);
  let sent = 0;
  for (const op of ops) {
    if (op.type !== 'mark_read') { await store.removeOp(op.id); continue; }
    const { error } = await ctx.sb.rpc('mark_notifications_read', { p_ids: op.ids });
    if (error && isNetworkError(error)) break;                       // still offline: retry later
    await store.removeOp(op.id); sent++;
  }
  return sent;
}
