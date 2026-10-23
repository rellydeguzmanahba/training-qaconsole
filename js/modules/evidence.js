import { friendlyError, UserError } from '../utils/errors.js';

export const MAX_BYTES = 10 * 1024 * 1024;                       // matches the bucket limit
export const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const BUCKET = 'evidence';

const safeName = (n) => String(n || 'file').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80) || 'file';

export function validateFile(file) {
  if (!ALLOWED.includes(file.type)) return 'Only JPG, PNG, WebP or PDF files are allowed.';
  if (file.size > MAX_BYTES) return 'The file is larger than 10 MB.';
  return null;
}

// Upload a file (private bucket) and register it. Cleans up the object if the row cannot be saved.
export async function addFile(ctx, violationId, file) {
  const bad = validateFile(file);
  if (bad) throw new UserError(bad);
  const path = `${violationId}/${crypto.randomUUID()}-${safeName(file.name)}`;
  const up = await ctx.sb.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (up.error) throw up.error;
  const { error } = await ctx.sb.from('violation_evidence').insert(
    { violation_id: violationId, storage_path: path, file_name: file.name.slice(0, 200), uploaded_by: ctx.profile.user_id });
  if (error) { await ctx.sb.storage.from(BUCKET).remove([path]); throw error; }
}

export async function addLink(ctx, violationId, url) {
  let u;
  try { u = new URL(url); } catch { throw new UserError('Enter a valid link.'); }
  if (u.protocol !== 'https:') throw new UserError('Links must start with https://');
  const { error } = await ctx.sb.from('violation_evidence').insert(
    { violation_id: violationId, external_url: u.href, file_name: u.hostname, uploaded_by: ctx.profile.user_id });
  if (error) throw error;
}

// Private files open through a short-lived signed link.
export async function openEvidence(ctx, ev) {
  if (ev.external_url) {
    let u; try { u = new URL(ev.external_url); } catch { return; }
    if (u.protocol === 'https:') window.open(u.href, '_blank', 'noopener,noreferrer');
    return;
  }
  const w = window.open('about:blank', '_blank');                // opened first so pop-up blockers allow it
  const { data, error } = await ctx.sb.storage.from(BUCKET).createSignedUrl(ev.storage_path, 120);
  if (error) { w?.close(); ctx.toast(friendlyError(error), 'error'); return; }
  if (w) { w.opener = null; w.location.href = data.signedUrl; }
}

export async function removeEvidence(ctx, ev) {
  const { data, error } = await ctx.sb.from('violation_evidence').delete().eq('id', ev.id).select('id');
  if (error) throw error;
  if (!data.length) throw new UserError('You do not have permission to remove this evidence.');
  if (ev.storage_path) await ctx.sb.storage.from(BUCKET).remove([ev.storage_path]);   // best effort
}

export const removeObjects = (ctx, paths) => (paths.length ? ctx.sb.storage.from(BUCKET).remove(paths) : null);
