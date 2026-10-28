import { el } from '../utils/dom.js';
import { errorState } from '../ui/states.js';
import { dataTable } from '../ui/table.js';
import { formModal } from '../ui/form.js';
import { badge, SEVERITY_VARIANT, VIOLATION_STATUS_VARIANT, RESULT_VARIANT } from '../ui/badge.js';
import { friendlyError } from '../utils/errors.js';
import { fmtDate, fmtDateTime } from '../utils/dates.js';
import { ordinal } from '../utils/validate.js';
import { openViolationForm } from './violation-form.js';
import { openRetrainingForm } from './retraining-form.js';
import { addFile, addLink, openEvidence, removeEvidence, removeObjects } from './evidence.js';
import { evidenceShareAvailable } from '../utils/schema.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const section = (title, body, extra = null) =>
  el('div', { class: 'card card--flush' }, el('div', { class: 'section-title' }, el('h3', {}, title), extra), body);
const pad = (n) => el('div', { style: 'padding:20px' }, n);

export async function renderDetail(root, ctx, id) {
  const missing = () => root.append(el('div', { class: 'card empty' }, el('h2', {}, 'Violation not found'), el('a', { href: '#/violations' }, 'Back to violations')));
  if (!UUID.test(id)) return missing();
  const { sb } = ctx;
  const share = await evidenceShareAvailable(sb);

  let v, hist, people;
  try {
    const [a, prof] = await Promise.all([
      sb.from('violations').select(`*, technician:technicians(id,first_name,surname,company:companies(name)),
        action:action_types(name), violation_category_links(category_id,violation_categories(code,name)),
        violation_evidence(id,storage_path,external_url,file_name,uploaded_by,created_at${share ? ',visible_to_technician' : ''}),
        retrainings(id,retraining_date,result,trainer,remarks,training_types(name))`).eq('id', id).maybeSingle(),
      sb.from('profiles').select('user_id,full_name'),
    ]);
    if (a.error) throw a.error;
    if (prof.error) throw prof.error;
    v = a.data; people = new Map(prof.data.map((p) => [p.user_id, p.full_name]));
    if (!v) return missing();
    const h = await sb.from('v_offense_history').select('*').eq('technician_id', v.technician_id).eq('offense_date', v.violation_date).maybeSingle();
    if (h.error) throw h.error;
    hist = h.data;
  } catch (e) {
    console.error(e);
    root.append(errorState(friendlyError(e), () => location.reload()));
    return;
  }

  const reload = async () => { root.replaceChildren(); await renderDetail(root, ctx, id); };
  const guardedRun = async (fn, ok) => {
    try { await fn(); if (ok) ctx.toast(ok, 'success'); await reload(); } catch (e) { ctx.toast(friendlyError(e), 'error'); }
  };
  const techName = `${v.technician.first_name} ${v.technician.surname}`;
  const catIds = v.violation_category_links.map((l) => l.category_id);

  const edit = async () => {
    try { const saved = await openViolationForm(ctx, { record: { ...v, category_ids: catIds } });
      if (saved) { ctx.toast('Violation updated.', 'success'); await reload(); } } catch (e) { ctx.toast(friendlyError(e), 'error'); }
  };
  const assign = async () => {
    try {
      const r = await openRetrainingForm(ctx, { violation: { id: v.id, technician_id: v.technician_id, technician_name: techName, violation_date: v.violation_date } });
      if (r) { ctx.toast('Retraining assigned.', 'success'); await reload(); }
    } catch (e) { ctx.toast(friendlyError(e), 'error'); }
  };
  const del = async () => {
    if (!(await ctx.confirm({ title: 'Delete this violation?', confirmText: 'Delete', danger: true,
      message: 'This permanently removes the violation and its evidence records. Violations linked to retraining or an approved offense action cannot be deleted.' }))) return;
    const paths = v.violation_evidence.map((e) => e.storage_path).filter(Boolean);
    const { error } = await sb.from('violations').delete().eq('id', id);
    if (error) return ctx.toast(friendlyError(error), 'error');
    await removeObjects(ctx, paths);
    ctx.toast('Violation deleted.', 'success');
    ctx.navigate('violations');
  };

  const toggleShare = async (e) => {
    const next = !e.visible_to_technician;
    if (next && !(await ctx.confirm({ title: 'Share this evidence with the technician?', confirmText: 'Share',
      message: 'The technician will be able to open this item in their portal. Only share evidence that is appropriate for them to see.' }))) return;
    const { data, error } = await sb.from('violation_evidence').update({ visible_to_technician: next }).eq('id', e.id).select('id');
    if (error || !data?.length) return ctx.toast(error ? friendlyError(error) : 'You do not have permission to change this.', 'error');
    ctx.toast(next ? 'Shared with the technician.' : 'Now private.', 'success'); await reload();
  };
  const addEvidence = async () => {
    const r = await formModal({ title: 'Add evidence', submitText: 'Add',
      intro: el('p', { class: 'muted small' }, 'Upload a JPG, PNG, WebP or PDF (max 10 MB), paste a link, or both.'),
      fields: [{ name: 'file', label: 'File', type: 'file', accept: 'image/jpeg,image/png,image/webp,application/pdf' },
        { name: 'url', label: 'Link (https://…)', type: 'text', maxlength: 500 }],
      validate: (x) => (!x.file && !x.url ? { file: 'Add a file or a link.' } : {}),
      onSubmit: async (x) => { if (x.file) await addFile(ctx, id, x.file); if (x.url) await addLink(ctx, id, x.url); } });
    if (r) { ctx.toast('Evidence added.', 'success'); await reload(); }
  };

  // ---- sections
  const dl = (pairs) => el('dl', { class: 'dl' }, pairs.map(([k, val]) => el('div', {}, el('dt', {}, k), el('dd', {}, val ?? '—'))));
  const info = section('Details', pad(el('div', { class: 'stack' }, dl([
    ['Technician', el('a', { href: `#/technicians/${v.technician.id}` }, techName)], ['Company', v.technician.company?.name],
    ['Date reported', fmtDate(v.violation_date)], ['Severity', badge(v.severity, SEVERITY_VARIANT[v.severity])],
    ['Status', badge(v.status, VIOLATION_STATUS_VARIANT[v.status])], ['Reported by', v.reported_by],
    ['Action taken', v.action?.name], ['Counts as offense', v.retraining_required ? 'Yes (retraining required)' : 'No'],
    ['IBAS no.', v.ibas_no], ['JO number', v.jo_number], ['Recorded', fmtDateTime(v.created_at)],
  ]),
  el('div', {}, el('div', { class: 'card__title' }, 'Categories'),
    el('div', { class: 'stack', style: 'gap:4px' }, v.violation_category_links.map((l) =>
      el('div', {}, el('strong', {}, l.violation_categories?.code), ' – ', l.violation_categories?.name)))),
  ...[['Description', v.description], ['Corrective action', v.corrective_action], ['Recommendation', v.recommendation], ['Remarks', v.remarks]]
    .filter(([, t]) => t).map(([k, t]) => el('div', {}, el('div', { class: 'card__title' }, k), el('p', { style: 'white-space:pre-wrap' }, t))))),
  ctx.can('violations:write') ? el('button', { class: 'btn btn--sm', type: 'button', onclick: edit }, 'Edit') : null);

  const impact = section('Offense impact', pad(hist
    ? dl([['Offense level', `${ordinal(hist.offense_no)} offense`], ['Penalty', hist.penalty],
      ['Hold until', hist.hold_until ? fmtDate(hist.hold_until) : '—'],
      ['Approval', hist.approval_status ? badge(hist.approval_status, hist.approval_status === 'approved' ? 'green' : hist.approval_status === 'rejected' ? 'red' : 'amber') : 'Not required'],
      ['Same-day violations', hist.violations_count > 1 ? `${hist.violations_count} counted as one offense` : '1']])
    : el('p', { class: 'muted' }, v.retraining_required ? 'No offense calculated yet.' : 'This violation does not count toward offense levels.')));

  const evidence = section(`Evidence (${v.violation_evidence.length})`, dataTable({ rows: v.violation_evidence, pageSize: 10, empty: 'No evidence attached.',
    columns: [{ key: 'file_name', label: 'Item', render: (e) => el('span', {}, e.file_name || 'File', ' ', badge(e.external_url ? 'Link' : 'File')) },
      { key: 'by', label: 'Added by', sort: (e) => people.get(e.uploaded_by) ?? '', render: (e) => people.get(e.uploaded_by) ?? '—' },
      { key: 'created_at', label: 'Added', render: (e) => fmtDateTime(e.created_at) },
      ...(share ? [{ key: 'shared', label: 'Technician can see', nosort: true, render: (e) => (ctx.can('violations:write')
        ? el('button', { class: 'btn btn--sm', type: 'button', onclick: () => toggleShare(e) }, e.visible_to_technician ? 'Shared · make private' : 'Private · share')
        : badge(e.visible_to_technician ? 'Shared' : 'Private', e.visible_to_technician ? 'green' : '')) }] : []),
      { key: 'a', label: '', nosort: true, render: (e) => el('div', { class: 'cell-actions' },
        el('button', { class: 'btn btn--sm', type: 'button', onclick: () => openEvidence(ctx, e) }, 'Open'),
        ctx.can('violations:write') ? el('button', { class: 'btn btn--sm', type: 'button', onclick: async () => {
          if (await ctx.confirm({ title: 'Remove this evidence?', confirmText: 'Remove', danger: true, message: 'The file or link will be removed from this violation.' })) {
            guardedRun(() => removeEvidence(ctx, e), 'Evidence removed.');
          } } }, 'Remove') : null) }] }),
    ctx.can('violations:write') ? el('button', { class: 'btn btn--sm', type: 'button', onclick: addEvidence }, 'Add evidence') : null);

  const retr = section('Linked retraining', dataTable({ rows: v.retrainings, pageSize: 10, empty: 'No retraining assigned.',
    columns: [{ key: 'training', label: 'Training', sort: (r) => r.training_types?.name ?? '', render: (r) => r.training_types?.name },
      { key: 'retraining_date', label: 'Date', render: (r) => (r.retraining_date ? fmtDate(r.retraining_date) : 'Not scheduled') },
      { key: 'result', label: 'Result', render: (r) => badge(r.result, RESULT_VARIANT[r.result]) },
      { key: 'trainer', label: 'Trainer' }, { key: 'remarks', label: 'Remarks', nosort: true }] }),
    ctx.can('retraining:write') && v.retraining_required ? el('button', { class: 'btn btn--sm', type: 'button', onclick: assign }, 'Assign retraining') : null);

  root.append(
    el('div', {}, el('a', { class: 'back-link', href: '#/violations' }, '← Violations'),
      el('div', { class: 'page-head' }, el('div', {}, el('h2', {}, `Violation – ${techName}`),
        el('p', { class: 'muted' }, fmtDate(v.violation_date))),
        ctx.role === 'admin' ? el('button', { class: 'btn btn--sm', type: 'button', onclick: del }, 'Delete') : null)),
    info, impact, el('div', { class: 'grid grid--2' }, evidence, retr));
}
