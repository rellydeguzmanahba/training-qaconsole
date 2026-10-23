import { el } from '../utils/dom.js';
import { dataTable } from '../ui/table.js';
import { badge, SEVERITY_VARIANT, VIOLATION_STATUS_VARIANT, RESULT_VARIANT } from '../ui/badge.js';
import { fetchAll } from '../utils/db.js';
import { friendlyError } from '../utils/errors.js';
import { fmtDate } from '../utils/dates.js';
import { openRetrainingForm } from './retraining-form.js';

const nm = (t) => (t ? `${t.first_name} ${t.surname}` : '—');
const codes = (links) => links.map((l) => l.violation_categories?.code).filter(Boolean).join(', ');

export async function render(root, ctx) {
  const { sb } = ctx;
  const S = { tab: 'needs', q: '', result: '', type: '', company: '', from: '', to: '' };
  let D;
  const body = el('div');

  async function load() {
    const [ret, vio, types, co] = await Promise.all([
      fetchAll(() => sb.from('retrainings')
        .select('id,violation_id,technician_id,training_type_id,retraining_date,trainer,result,remarks,manual_reason,version,created_at,training_types(name),technician:technicians(first_name,surname,company_id),violation:violations(violation_date,violation_category_links(violation_categories(code)))')
        .order('created_at', { ascending: false }).order('id')),
      fetchAll(() => sb.from('violations')
        .select('id,technician_id,violation_date,severity,status,technician:technicians(first_name,surname,company_id),violation_category_links(violation_categories(code))')
        .eq('retraining_required', true).neq('status', 'Closed').order('violation_date').order('id')),
      sb.from('training_types').select('id,name').eq('active', true).order('sort_order').order('id'),
      sb.from('companies').select('id,name').eq('active', true).order('name'),
    ]);
    for (const r of [types, co]) if (r.error) throw r.error;
    const active = new Set(ret.filter((r) => r.result !== 'Failed').map((r) => r.violation_id));   // Pending or Passed
    const failed = new Map();
    for (const r of ret) if (r.result === 'Failed' && r.violation_id) failed.set(r.violation_id, (failed.get(r.violation_id) || 0) + 1);
    D = { ret, types: types.data, companies: co.data,
      needs: vio.filter((v) => !active.has(v.id)).map((v) => ({ ...v, failed: failed.get(v.id) || 0 })) };
  }

  const refresh = async () => { await load(); draw(); };
  const open = async (opts, okMsg) => {
    try { const r = await openRetrainingForm(ctx, opts); if (r) { ctx.toast(okMsg, 'success'); await refresh(); } }
    catch (e) { ctx.toast(friendlyError(e), 'error'); }
  };

  function needs() {
    const rows = D.needs.filter((v) => !S.company || String(v.technician?.company_id) === S.company);
    return el('div', { class: 'card card--flush' }, dataTable({ rows, pageSize: 25, initialSort: { key: 'violation_date' },
      empty: 'Every violation that requires retraining has retraining assigned.',
      columns: [{ key: 'violation_date', label: 'Violation', render: (v) => el('a', { href: `#/violations/${v.id}` }, fmtDate(v.violation_date)) },
        { key: 'tech', label: 'Technician', sort: (v) => nm(v.technician), render: (v) => el('a', { href: `#/technicians/${v.technician_id}` }, nm(v.technician)) },
        { key: 'cat', label: 'Categories', nosort: true, render: (v) => codes(v.violation_category_links) },
        { key: 'severity', label: 'Severity', render: (v) => badge(v.severity, SEVERITY_VARIANT[v.severity]) },
        { key: 'status', label: 'Status', render: (v) => badge(v.status, VIOLATION_STATUS_VARIANT[v.status]) },
        { key: 'failed', label: 'Failed attempts', render: (v) => (v.failed ? badge(String(v.failed), 'red') : '—') },
        { key: 'a', label: '', nosort: true, render: (v) => (ctx.can('retraining:write')
          ? el('button', { class: 'btn btn--sm', type: 'button', onclick: () => open({ violation: { id: v.id, technician_id: v.technician_id, technician_name: nm(v.technician), violation_date: v.violation_date } }, 'Retraining assigned.') }, 'Assign')
          : null) }] }));
  }

  function records() {
    const q = el('input', { class: 'input', type: 'search', placeholder: 'Search technician or trainer…', value: S.q, 'aria-label': 'Search' });
    const res = el('select', { class: 'input', 'aria-label': 'Outcome' }, el('option', { value: '' }, 'All outcomes'),
      ['Pending', 'Passed', 'Failed'].map((x) => el('option', { value: x }, x)));
    const ty = el('select', { class: 'input', 'aria-label': 'Training' }, el('option', { value: '' }, 'All trainings'),
      D.types.map((t) => el('option', { value: String(t.id) }, t.name)));
    const from = el('input', { class: 'input', type: 'date', value: S.from, 'aria-label': 'From date' });
    const to = el('input', { class: 'input', type: 'date', value: S.to, 'aria-label': 'To date' });
    res.value = S.result; ty.value = S.type;
    const holder = el('div', { class: 'card card--flush' });

    const paint = () => {
      Object.assign(S, { q: q.value, result: res.value, type: ty.value, from: from.value, to: to.value });
      const t = S.q.trim().toLowerCase();
      const rows = D.ret.filter((r) =>
        (!S.company || String(r.technician?.company_id) === S.company) && (!S.result || r.result === S.result) &&
        (!S.type || String(r.training_type_id) === S.type) &&
        (!S.from || (r.retraining_date && r.retraining_date >= S.from)) && (!S.to || (r.retraining_date && r.retraining_date <= S.to)) &&
        (!t || nm(r.technician).toLowerCase().includes(t) || (r.trainer || '').toLowerCase().includes(t)));
      holder.replaceChildren(dataTable({ rows, pageSize: 25, initialSort: { key: 'created', dir: 'desc' }, empty: 'No retraining records match.',
        columns: [{ key: 'created', label: 'Assigned', sort: (r) => r.created_at, render: (r) => fmtDate(r.created_at.slice(0, 10)) },
          { key: 'tech', label: 'Technician', sort: (r) => nm(r.technician), render: (r) => el('a', { href: `#/technicians/${r.technician_id}` }, nm(r.technician)) },
          { key: 'type', label: 'Training', sort: (r) => r.training_types?.name ?? '', render: (r) => r.training_types?.name },
          { key: 'violation', label: 'Linked violation', sort: (r) => r.violation?.violation_date ?? '',
            render: (r) => (r.violation_id ? el('a', { href: `#/violations/${r.violation_id}` }, `${fmtDate(r.violation?.violation_date)} ${codes(r.violation?.violation_category_links || [])}`.trim())
              : el('span', { class: 'muted', title: r.manual_reason || '' }, 'Manual')) },
          { key: 'retraining_date', label: 'Date', render: (r) => (r.retraining_date ? fmtDate(r.retraining_date) : 'Not scheduled') },
          { key: 'trainer', label: 'Trainer' },
          { key: 'result', label: 'Outcome', render: (r) => badge(r.result, RESULT_VARIANT[r.result]) },
          { key: 'a', label: '', nosort: true, render: (r) => (ctx.can('retraining:write')
            ? el('button', { class: 'btn btn--sm', type: 'button', onclick: () => open({ record: { ...r, technician_name: nm(r.technician), type_name: r.training_types?.name, violation_date: r.violation?.violation_date } }, 'Retraining updated.') }, r.result === 'Pending' ? 'Record outcome' : 'Edit')
            : null) }] }));
    };
    [q, res, ty, from, to].forEach((n) => n.addEventListener('input', paint));
    paint();
    return el('div', { class: 'stack' }, el('div', { class: 'toolbar' }, q, res, ty,
      el('label', { class: 'row small' }, 'From', from), el('label', { class: 'row small' }, 'To', to)), holder);
  }

  function draw() {
    const c = (r) => D.ret.filter((x) => x.result === r).length;
    stats.replaceChildren(...[['Needs assignment', D.needs.length], ['Pending', c('Pending')], ['Passed', c('Passed')], ['Failed', c('Failed')]]
      .map(([t, n]) => el('div', { class: 'card' }, el('div', { class: 'card__title' }, t), el('div', { class: 'stat' }, n))));
    tabs.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.id === S.tab)));
    body.replaceChildren(S.tab === 'needs' ? needs() : records());
  }

  const stats = el('div', { class: 'grid grid--cards', style: 'margin-bottom:16px' });
  const tabs = el('div', { class: 'tabs', role: 'tablist' },
    [['needs', 'Needs retraining'], ['records', 'Retraining records']].map(([id, label]) =>
      el('button', { class: 'tab', type: 'button', role: 'tab', dataset: { id }, onclick: () => { S.tab = id; draw(); } }, label)));

  try { await load(); } catch (e) {
    console.error(e);
    root.append(el('div', { class: 'alert alert--error' }, friendlyError(e)));
    return;
  }
  const co = el('select', { class: 'input', 'aria-label': 'Companies' }, el('option', { value: '' }, 'All companies'),
    D.companies.map((c) => el('option', { value: String(c.id) }, c.name)));
  co.addEventListener('input', () => { S.company = co.value; draw(); });

  root.append(
    el('div', { class: 'page-head' }, el('div', {}, el('h2', {}, 'Retraining'),
      el('p', { class: 'muted small' }, 'A pending retraining marks its violation “For Retraining”; passing it closes the violation. Failed attempts stay on record.')),
      ctx.can('retraining:write') ? el('button', { class: 'btn btn--primary', type: 'button', onclick: () => open({}, 'Retraining saved.') }, 'Add retraining') : null),
    stats, el('div', { class: 'toolbar' }, co), tabs, body);
  draw();
}
