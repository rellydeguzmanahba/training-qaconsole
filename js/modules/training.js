import { el } from '../utils/dom.js';
import { errorState } from '../ui/states.js';
import { dataTable } from '../ui/table.js';
import { badge } from '../ui/badge.js';
import { fetchAll } from '../utils/db.js';
import { friendlyError } from '../utils/errors.js';
import { fmtDate } from '../utils/dates.js';
import { openTrainingForm, trainingToast } from './training-form.js';

const ACTIVE = ['Probationary', 'Regular'];
const TABS = [['overview', 'Completion'], ['matrix', 'Matrix'], ['missing', 'Missing training'], ['records', 'Records'], ['attendance', 'Attendance'], ['exam-ai', 'AI Exam Generator']];
const nm = (t) => `${t.first_name} ${t.surname}`;

export async function render(root, ctx) {
  const { sb } = ctx;
  const S = { tab: 'overview', company: '', designation: '', scope: 'active', q: '', type: '', from: '', to: '' };
  let D;                                                   // loaded data
  const body = el('div');

  async function load() {
    const [techs, types, recs, co, de] = await Promise.all([
      fetchAll(() => sb.from('technicians')
        .select('id,first_name,middle_name,surname,employment_status,company_id,designation_id,company:companies(name),designation:designations(name)')
        .order('surname').order('first_name').order('id')),
      sb.from('training_types').select('id,name,required').eq('active', true).order('sort_order').order('id'),
      fetchAll(() => sb.from('training_records').select('id,technician_id,training_type_id,completed_on,trainer,remarks,version')
        .order('completed_on', { ascending: false }).order('id')),
      sb.from('companies').select('id,name').eq('active', true).order('name'),
      sb.from('designations').select('id,name').eq('active', true).order('name'),
    ]);
    for (const r of [types, co, de]) if (r.error) throw r.error;
    const latest = new Map();                              // technician -> (type -> latest record); recs are newest first
    for (const r of recs) {
      if (!latest.has(r.technician_id)) latest.set(r.technician_id, new Map());
      const m = latest.get(r.technician_id);
      if (!m.has(r.training_type_id)) m.set(r.training_type_id, r);
    }
    D = { techs, types: types.data, recs, latest, companies: co.data, designations: de.data,
      tech: new Map(techs.map((t) => [t.id, t])), type: new Map(types.data.map((t) => [t.id, t])) };
  }

  const eligible = () => D.techs.filter((t) =>
    (S.scope === 'all' || ACTIVE.includes(t.employment_status)) &&
    (!S.company || String(t.company_id) === S.company) &&
    (!S.designation || String(t.designation_id) === S.designation));
  const required = () => D.types.filter((t) => t.required);
  const missingFor = (t) => required().filter((ty) => !D.latest.get(t.id)?.has(ty.id));
  const link = (t) => el('a', { href: `#/technicians/${t.id}` }, nm(t));

  const record = async (opts) => {
    try {
      const r = await openTrainingForm(ctx, opts);
      if (r) { trainingToast(ctx, r); await load(); draw(); }
    } catch (e) { ctx.toast(friendlyError(e), 'error'); }
  };

  // ---------- tabs ----------
  function overview() {
    const elig = eligible(), req = required();
    let done = 0, full = 0;
    for (const t of elig) { const c = req.length - missingFor(t).length; done += c; if (req.length && c === req.length) full++; }
    const pct = elig.length && req.length ? Math.round((100 * done) / (elig.length * req.length)) : 0;
    const stat = (title, v) => el('div', { class: 'card' }, el('div', { class: 'card__title' }, title), el('div', { class: 'stat' }, v));
    const rows = D.types.map((ty) => {
      const c = elig.filter((t) => D.latest.get(t.id)?.has(ty.id)).length;
      return { ...ty, completed: c, pending: elig.length - c, pct: elig.length ? Math.round((100 * c) / elig.length) : 0 };
    });
    return el('div', { class: 'stack' },
      el('div', { class: 'grid grid--cards' },
        stat('Technicians in scope', elig.length), stat('Overall completion', req.length ? `${pct}%` : '—'),
        stat('Fully trained', req.length ? full : '—'), stat('With missing training', req.length ? elig.length - full : '—')),
      req.length ? null : el('div', { class: 'callout' }, 'No required training types are configured, so completion cannot be calculated. An admin can set them in Settings → Training types.'),
      el('div', { class: 'card card--flush' }, dataTable({ rows, pageSize: 50, empty: 'No training types configured.',
        columns: [{ key: 'name', label: 'Training' },
          { key: 'required', label: 'Type', render: (r) => badge(r.required ? 'Required' : 'Optional', r.required ? 'green' : '') },
          { key: 'completed', label: 'Completed' }, { key: 'pending', label: 'Pending' },
          { key: 'pct', label: 'Completion', render: (r) => el('div', { class: 'row', style: 'flex-wrap:nowrap' },
            el('div', { class: 'bar', style: 'width:140px' }, el('span', { style: `width:${r.pct}%` })), `${r.pct}%`) }] })));
  }

  function matrix() {
    const elig = eligible();
    if (!elig.length) return el('div', { class: 'card empty muted' }, 'No technicians match the filters.');
    const head = el('tr', {}, el('th', { scope: 'col' }, 'Technician'),
      D.types.map((ty) => el('th', { scope: 'col', title: ty.name }, ty.name, ty.required ? null : ' (optional)')));
    const rows = elig.map((t) => el('tr', {}, el('td', {}, link(t)),
      D.types.map((ty) => {
        const r = D.latest.get(t.id)?.get(ty.id);
        return el('td', {}, r ? el('span', { class: 'badge badge--green', title: r.trainer ? `Trainer: ${r.trainer}` : '' }, fmtDate(r.completed_on))
          : (ty.required ? badge('Missing', 'amber') : '—'));
      })));
    return el('div', { class: 'card card--flush' }, el('div', { class: 'table-wrap' },
      el('table', { class: 'table matrix' }, el('thead', {}, head), el('tbody', {}, rows))));
  }

  function missing() {
    const rows = eligible().map((t) => ({ t, miss: missingFor(t) })).filter((r) => r.miss.length);
    return el('div', { class: 'card card--flush' }, dataTable({ rows, pageSize: 25, initialSort: { key: 'count', dir: 'desc' },
      empty: required().length ? 'No missing required training in this scope.' : 'No required training types are configured (Settings → Training types).',
      columns: [{ key: 'name', label: 'Technician', sort: (r) => nm(r.t), render: (r) => link(r.t) },
        { key: 'company', label: 'Company', sort: (r) => r.t.company?.name ?? '', render: (r) => r.t.company?.name },
        { key: 'designation', label: 'Designation', sort: (r) => r.t.designation?.name ?? '', render: (r) => r.t.designation?.name },
        { key: 'count', label: 'Missing', sort: (r) => r.miss.length, render: (r) => badge(`${r.miss.length} of ${required().length}`, 'amber') },
        { key: 'list', label: 'Training needed', nosort: true,
          render: (r) => el('div', { class: 'row', style: 'gap:4px' }, r.miss.map((m) => badge(m.name))) },
        { key: 'a', label: '', nosort: true, render: (r) => (ctx.can('training:write')
          ? el('button', { class: 'btn btn--sm', type: 'button', onclick: () => record({ technicianId: r.t.id }) }, 'Record') : null) }] }));
  }

  function records() {
    const q = el('input', { class: 'input', type: 'search', placeholder: 'Search technician or trainer…', value: S.q, 'aria-label': 'Search records' });
    const ty = el('select', { class: 'input', 'aria-label': 'Training' }, el('option', { value: '' }, 'All trainings'),
      D.types.map((t) => el('option', { value: String(t.id) }, t.name)));
    ty.value = S.type;
    const from = el('input', { class: 'input', type: 'date', value: S.from, 'aria-label': 'From date' });
    const to = el('input', { class: 'input', type: 'date', value: S.to, 'aria-label': 'To date' });
    const holder = el('div', { class: 'card card--flush' });

    const edit = async (r) => record({ record: { ...r, technician_name: nm(D.tech.get(r.technician_id)), type_name: D.type.get(r.training_type_id)?.name } });
    const remove = async (r) => {
      if (!(await ctx.confirm({ title: 'Delete this training record?', message: 'This permanently removes the record (the deletion is kept in the audit log).', confirmText: 'Delete', danger: true }))) return;
      const { data, error } = await sb.from('training_records').delete().eq('id', r.id).select('id');
      if (error || !data?.length) return ctx.toast(error ? friendlyError(error) : 'Could not delete this record.', 'error');
      ctx.toast('Record deleted.', 'success'); await load(); draw();
    };

    const paint = () => {
      S.q = q.value; S.type = ty.value; S.from = from.value; S.to = to.value;
      const term = S.q.trim().toLowerCase();
      const rows = D.recs.filter((r) => {
        const t = D.tech.get(r.technician_id);
        if (!t) return false;
        if (S.company && String(t.company_id) !== S.company) return false;
        if (S.designation && String(t.designation_id) !== S.designation) return false;
        if (S.type && String(r.training_type_id) !== S.type) return false;
        if (S.from && r.completed_on < S.from) return false;
        if (S.to && r.completed_on > S.to) return false;
        return !term || nm(t).toLowerCase().includes(term) || (r.trainer || '').toLowerCase().includes(term);
      });
      holder.replaceChildren(dataTable({ rows, pageSize: 25, initialSort: { key: 'completed_on', dir: 'desc' }, empty: 'No training records match.',
        columns: [{ key: 'completed_on', label: 'Date', render: (r) => fmtDate(r.completed_on) },
          { key: 'tech', label: 'Technician', sort: (r) => nm(D.tech.get(r.technician_id)), render: (r) => link(D.tech.get(r.technician_id)) },
          { key: 'type', label: 'Training', sort: (r) => D.type.get(r.training_type_id)?.name ?? '', render: (r) => D.type.get(r.training_type_id)?.name },
          { key: 'trainer', label: 'Trainer' }, { key: 'remarks', label: 'Remarks', nosort: true },
          { key: 'a', label: '', nosort: true, render: (r) => el('div', { class: 'cell-actions' },
            ctx.can('training:write') ? el('button', { class: 'btn btn--sm', type: 'button', onclick: () => edit(r) }, 'Edit') : null,
            ctx.role === 'admin' ? el('button', { class: 'btn btn--sm', type: 'button', onclick: () => remove(r) }, 'Delete') : null) }] }));
    };
    [q, ty, from, to].forEach((n) => n.addEventListener('input', paint));
    paint();
    return el('div', { class: 'stack' }, el('div', { class: 'toolbar' }, q, ty,
      el('label', { class: 'row small' }, 'From', from), el('label', { class: 'row small' }, 'To', to)), holder);
  }

  // ---------- shell ----------
  function draw() {
    tabs.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.id === S.tab)));
    const fn = { overview, matrix, missing, records }[S.tab];
    if (S.tab === 'attendance') { body.replaceChildren(); import('./training-attendance.js').then(m=>m.renderAttendanceAdmin(body,ctx)).catch(e=>ctx.toast(friendlyError(e),'error')); }
    else if (S.tab === 'exam-ai') { body.replaceChildren(); import('./training-exam-generator.js').then(m=>m.renderExamGenerator(body,ctx)).catch(e=>ctx.toast(friendlyError(e),'error')); }
    else body.replaceChildren(fn());
    scopeSel.hidden = S.tab === 'records';
  }

  const mkSel = (label, items, key) => {
    const s = el('select', { class: 'input', 'aria-label': label }, el('option', { value: '' }, `All ${label.toLowerCase()}`),
      items.map((i) => el('option', { value: String(i.id) }, i.name)));
    s.addEventListener('input', () => { S[key] = s.value; draw(); });
    return s;
  };
  const tabs = el('div', { class: 'tabs', role: 'tablist' }, TABS.filter(([id]) => id !== 'exam-ai' || ['admin', 'trainer'].includes(ctx.role)).map(([id, label]) =>
    el('button', { class: 'tab', type: 'button', role: 'tab', dataset: { id }, onclick: () => { S.tab = id; draw(); } }, label)));

  try { await load(); } catch (e) {
    console.error(e);
    root.append(errorState(friendlyError(e), () => location.reload()));
    return;
  }
  const scopeSel = el('select', { class: 'input', 'aria-label': 'Scope' },
    el('option', { value: 'active' }, 'Active staff (probationary + regular)'), el('option', { value: 'all' }, 'All technicians'));
  scopeSel.addEventListener('input', () => { S.scope = scopeSel.value; draw(); });

  root.append(
    el('div', { class: 'page-head' }, el('div', {}, el('h2', {}, 'Training'),
      el('p', { class: 'muted small' }, 'Completion is based on training types marked Required in Settings.')),
      ctx.can('training:write') ? el('button', { class: 'btn btn--primary', type: 'button', onclick: () => record({}) }, 'Record training') : null),
    el('div', { class: 'toolbar' }, mkSel('Companies', D.companies, 'company'), mkSel('Designations', D.designations, 'designation'), scopeSel),
    tabs, body);
  draw();
}
