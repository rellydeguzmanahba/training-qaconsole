import { el } from '../utils/dom.js';
import { badge, SEVERITY_VARIANT, VIOLATION_STATUS_VARIANT } from '../ui/badge.js';
import { emptyState, errorState } from '../ui/states.js';
import { friendlyError } from '../utils/errors.js';
import { fmtDate } from '../utils/dates.js';
import { openEvidence } from '../modules/evidence.js';

const PAGE = 10;

// Violation History: the technician's own findings, with only the evidence QA chose to share.
export async function renderViolations(root, ctx) {
  const { sb } = ctx;
  const [v, ev] = await Promise.all([
    sb.from('v_my_violations').select('*').order('violation_date', { ascending: false }).order('id'),
    sb.from('v_my_evidence').select('*'),
  ]);
  for (const r of [v, ev]) if (r.error) { root.append(errorState(friendlyError(r.error), () => location.reload())); return; }
  const rows = v.data, evidence = new Map();
  for (const e of ev.data) evidence.set(e.violation_id, [...(evidence.get(e.violation_id) || []), e]);
  const focus = ctx.params[0] || null;

  const status = el('select', { class: 'input', 'aria-label': 'Status' }, el('option', { value: '' }, 'All statuses'), ['Open', 'For Retraining', 'Closed'].map((s) => el('option', { value: s }, s)));
  const sev = el('select', { class: 'input', 'aria-label': 'Severity' }, el('option', { value: '' }, 'All severities'), ['Minor', 'Major', 'Critical'].map((s) => el('option', { value: s }, s)));
  const count = el('p', { class: 'muted small', 'aria-live': 'polite' });
  const list = el('div', { class: 'pv-list' });
  let shown = PAGE;

  const item = (x) => {
    const files = evidence.get(x.id) || [];
    return el('details', { class: 'card pv', open: x.id === focus ? true : null },
      el('summary', {}, el('span', { class: 'pv__main' }, el('strong', {}, fmtDate(x.violation_date)), el('span', { class: 'small muted' }, x.category_codes?.join(', ') || 'QA finding')),
        el('span', { class: 'row', style: 'gap:6px' }, badge(x.severity, SEVERITY_VARIANT[x.severity]), badge(x.status, VIOLATION_STATUS_VARIANT[x.status]))),
      el('div', { class: 'pv__body stack' },
        x.category_names?.length ? el('ul', { class: 'pv__cats' }, x.category_names.map((n, i) => el('li', {}, el('strong', {}, x.category_codes[i]), ' – ', n))) : null,
        el('div', {}, el('div', { class: 'card__title' }, 'What was found'), el('p', { style: 'white-space:pre-wrap' }, x.description)),
        x.corrective_action ? el('div', {}, el('div', { class: 'card__title' }, 'Corrective action'), el('p', { style: 'white-space:pre-wrap' }, x.corrective_action)) : null,
        el('div', { class: 'row small muted' }, x.action_taken ? `Action taken: ${x.action_taken}` : null, x.retraining_required ? 'Retraining required' : 'No retraining required'),
        el('div', {}, el('div', { class: 'card__title' }, 'Evidence'), files.length
          ? el('div', { class: 'row' }, files.map((f) => el('button', { class: 'btn btn--sm', type: 'button', onclick: () => openEvidence(ctx, f) }, f.kind === 'link' ? 'Open link' : `Open ${f.file_name || 'file'}`)))
          : el('p', { class: 'small muted' }, 'No evidence has been shared with you for this violation.'))));
  };

  const paint = () => {
    const f = rows.filter((x) => (!status.value || x.status === status.value) && (!sev.value || x.severity === sev.value));
    count.textContent = `${f.length} violation${f.length === 1 ? '' : 's'}`;
    if (!rows.length) { list.replaceChildren(el('div', { class: 'card' }, emptyState({ icon: 'check', title: 'No QA violations', text: 'Nothing has been recorded against you.' }))); return; }
    if (!f.length) { list.replaceChildren(el('div', { class: 'card' }, emptyState({ title: 'No violations match', text: 'Try a different filter.' }))); return; }
    list.replaceChildren(...f.slice(0, shown).map(item),
      f.length > shown ? el('button', { class: 'btn', type: 'button', onclick: () => { shown += PAGE; paint(); } }, `Show more (${f.length - shown})`) : null);
  };
  [status, sev].forEach((n) => n.addEventListener('input', () => { shown = PAGE; paint(); }));
  const open = rows.filter((x) => x.status !== 'Closed').length;
  root.append(el('header', { class: 'portal-welcome' }, el('h2', {}, 'Violation History'), el('p', { class: 'muted' }, `${rows.length} on record · ${open} still open`)),
    el('div', { class: 'toolbar' }, status, sev), count, list);
  paint();
}
