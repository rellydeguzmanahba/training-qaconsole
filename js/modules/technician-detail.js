import { el } from '../utils/dom.js';
import { dataTable } from '../ui/table.js';
import { badge, EMPLOYMENT_VARIANT, SEVERITY_VARIANT, VIOLATION_STATUS_VARIANT, RESULT_VARIANT,
  MONITORING_VARIANT, deploymentVariant } from '../ui/badge.js';
import { friendlyError } from '../utils/errors.js';
import { fmtDate, fmtDateTime } from '../utils/dates.js';
import { ordinal } from '../utils/validate.js';
import { openTechnicianForm } from './technician-form.js';
import { openTrainingForm, trainingToast } from './training-form.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const section = (title, body, extra = null) =>
  el('div', { class: 'card card--flush' }, el('div', { class: 'section-title' }, el('h3', {}, title), extra), body);
const pad = (node) => el('div', { style: 'padding:20px' }, node);

export async function renderDetail(root, ctx, id) {
  if (!UUID.test(id)) { root.append(el('div', { class: 'card empty' }, el('h2', {}, 'Technician not found'))); return; }
  const { sb } = ctx;

  let d;
  try {
    const [t, types, recs, viol, ret, off, hist, prof] = await Promise.all([
      sb.from('technicians').select('*,company:companies(name),designation:designations(name),technician_access(access_id,access_systems(name))').eq('id', id).maybeSingle(),
      sb.from('training_types').select('id,name,required,sort_order').eq('active', true).order('sort_order'),
      sb.from('training_records').select('id,completed_on,trainer,remarks,training_type_id,training_types(name)').eq('technician_id', id).order('completed_on', { ascending: false }),
      sb.from('violations').select('id,violation_date,severity,status,description,retraining_required,violation_category_links(violation_categories(code))').eq('technician_id', id).order('violation_date', { ascending: false }),
      sb.from('retrainings').select('id,retraining_date,result,trainer,remarks,training_types(name)').eq('technician_id', id).order('retraining_date', { ascending: false, nullsFirst: true }),
      sb.from('v_offense_status').select('*').eq('technician_id', id).maybeSingle(),
      sb.from('v_offense_history').select('*').eq('technician_id', id).order('offense_date', { ascending: false }),
      sb.from('profiles').select('user_id,full_name'),
    ]);
    for (const r of [t, types, recs, viol, ret, off, hist, prof]) if (r.error) throw r.error;
    d = { t: t.data, types: types.data, recs: recs.data, viol: viol.data, ret: ret.data, off: off.data, hist: hist.data, people: new Map(prof.data.map((p) => [p.user_id, p.full_name])) };
    if (ctx.can('audit:view')) {
      const a = await sb.from('audit_log').select('id,at,table_name,action,old_data,new_data,actor').eq('technician_id', id).order('at', { ascending: false }).limit(100);
      if (a.error) throw a.error;
      d.audit = a.data;
    }
  } catch (e) {
    console.error(e);
    root.append(el('div', { class: 'alert alert--error' }, friendlyError(e)));
    return;
  }
  if (!d.t) { root.append(el('div', { class: 'card empty' }, el('h2', {}, 'Technician not found'), el('a', { href: '#/technicians' }, 'Back to technicians'))); return; }

  const t = d.t;
  const name = [t.first_name, t.middle_name, t.surname].filter(Boolean).join(' ');
  const reload = async () => { root.replaceChildren(); await renderDetail(root, ctx, id); };
  const edit = async () => {
    const saved = await openTechnicianForm(ctx, { ...t, access: t.technician_access.map((a) => a.access_id) });
    if (saved) { ctx.toast('Technician updated.', 'success'); await reload(); }
  };
  const recordTraining = async () => {
    try { const r = await openTrainingForm(ctx, { technicianId: id }); if (r) { trainingToast(ctx, r); await reload(); } }
    catch (e) { ctx.toast(friendlyError(e), 'error'); }
  };
  const dl = (pairs) => el('dl', { class: 'dl' }, pairs.map(([k, v]) => el('div', {}, el('dt', {}, k), el('dd', {}, v ?? '—'))));

  // ---- profile
  const access = t.technician_access.map((a) => a.access_systems?.name).filter(Boolean).join(', ');
  const profile = section('Profile', pad(dl([
    ['Company', t.company?.name], ['Designation', t.designation?.name],
    ['Employment status', badge(t.employment_status, EMPLOYMENT_VARIANT[t.employment_status])],
    ['Date hired', fmtDate(t.date_hired)], ['Birthdate', fmtDate(t.birthdate)],
    ['Mobile', t.mobile], ['Email', t.email],
    ...(t.date_separated || ['Resigned', 'Terminated'].includes(t.employment_status)
      ? [['Date separated', fmtDate(t.date_separated)], ['Separation reason', t.separation_reason]] : []),
    ['LMS username', t.lms_user], ['LMS login', t.lms_login], ['Account access', access || 'None'],
  ])), ctx.can('technicians:write') ? el('button', { class: 'btn btn--sm', type: 'button', onclick: edit }, 'Edit') : null);

  // ---- offense / deployment
  const o = d.off;
  const offense = section('Offense monitoring & deployment', o ? pad(dl([
    ['Monitoring', badge(o.monitoring_status, MONITORING_VARIANT[o.monitoring_status])],
    ['Deployment', badge(o.deployment_status, deploymentVariant(o.deployment_status))],
    ['Current offense', o.current_offense_no ? ordinal(o.current_offense_no) : 'None'],
    ['Monitoring until', o.current_offense_no ? fmtDate(o.monitoring_until) : '—'],
    ['Current penalty', o.current_penalty], ['Last offense', fmtDate(o.last_offense_date)],
    ['If next violation is minor', o.next_if_minor], ['If next violation is major', o.next_if_major],
    ['Needs review', o.requires_review ? badge(o.review_reason || 'Yes', 'amber') : 'No'],
  ])) : pad(el('p', { class: 'muted' }, 'No offense data.')));

  // ---- training progress (latest record per type)
  const latest = new Map();
  for (const r of d.recs) if (!latest.has(r.training_type_id)) latest.set(r.training_type_id, r);
  const progress = d.types.map((ty) => ({ ...ty, rec: latest.get(ty.id) ?? null }));
  const doneCount = progress.filter((p) => p.required && p.rec).length;
  const reqCount = progress.filter((p) => p.required).length;
  const training = section(`Training progress (${doneCount}/${reqCount} required)`, dataTable({
    rows: progress, pageSize: 50, initialSort: null,
    columns: [{ key: 'name', label: 'Training', nosort: true, render: (r) => el('span', {}, r.name, ' ', r.required ? null : badge('Optional')) },
      { key: 'st', label: 'Status', nosort: true, render: (r) => (r.rec ? badge('Completed', 'green') : badge(r.required ? 'Missing' : 'Not taken', r.required ? 'amber' : '')) },
      { key: 'date', label: 'Completed', nosort: true, render: (r) => (r.rec ? fmtDate(r.rec.completed_on) : '—') },
      { key: 'tr', label: 'Trainer', nosort: true, render: (r) => r.rec?.trainer }],
  }), ctx.can('training:write') ? el('button', { class: 'btn btn--sm', type: 'button', onclick: recordTraining }, 'Record') : null);

  const trainingHistory = section('Training history', dataTable({
    rows: d.recs, pageSize: 10, empty: 'No training recorded yet.',
    columns: [{ key: 'completed_on', label: 'Date', render: (r) => fmtDate(r.completed_on) },
      { key: 'type', label: 'Training', sort: (r) => r.training_types?.name, render: (r) => r.training_types?.name },
      { key: 'trainer', label: 'Trainer' }, { key: 'remarks', label: 'Remarks' }],
  }));

  const violations = section('Violation history', dataTable({
    rows: d.viol, pageSize: 10, empty: 'No violations recorded.',
    columns: [{ key: 'violation_date', label: 'Date', render: (r) => el('a', { href: `#/violations/${r.id}` }, fmtDate(r.violation_date)) },
      { key: 'cat', label: 'Categories', nosort: true,
        render: (r) => r.violation_category_links.map((l) => l.violation_categories?.code).filter(Boolean).join(', ') },
      { key: 'severity', label: 'Severity', render: (r) => badge(r.severity, SEVERITY_VARIANT[r.severity]) },
      { key: 'status', label: 'Status', render: (r) => badge(r.status, VIOLATION_STATUS_VARIANT[r.status]) },
      { key: 'retraining_required', label: 'Counts as offense', render: (r) => (r.retraining_required ? 'Yes' : 'No') },
      { key: 'description', label: 'Description', nosort: true }],
  }));

  const retraining = section('Retraining history', dataTable({
    rows: d.ret, pageSize: 10, empty: 'No retraining recorded.',
    columns: [{ key: 'retraining_date', label: 'Date', render: (r) => (r.retraining_date ? fmtDate(r.retraining_date) : 'Not scheduled') },
      { key: 'type', label: 'Training', sort: (r) => r.training_types?.name, render: (r) => r.training_types?.name },
      { key: 'result', label: 'Result', render: (r) => badge(r.result, RESULT_VARIANT[r.result]) },
      { key: 'trainer', label: 'Trainer' }, { key: 'remarks', label: 'Remarks' }],
  }));

  const offenseHistory = section('Offense history', dataTable({
    rows: d.hist, pageSize: 10, empty: 'No counted offenses.',
    columns: [{ key: 'offense_date', label: 'Date', render: (r) => fmtDate(r.offense_date) },
      { key: 'offense_no', label: 'Offense', render: (r) => ordinal(r.offense_no) },
      { key: 'severity_group', label: 'Severity' }, { key: 'penalty', label: 'Penalty' },
      { key: 'hold_until', label: 'Hold until', render: (r) => (r.hold_until ? fmtDate(r.hold_until) : '—') },
      { key: 'approval_status', label: 'Approval',
        render: (r) => (r.approval_status ? badge(r.approval_status, r.approval_status === 'approved' ? 'green' : r.approval_status === 'rejected' ? 'red' : 'amber') : '—') }],
  }));

  // ---- audit (admin / QA / supervisor)
  const summarize = (a) => {
    if (a.action === 'INSERT') return 'Created';
    if (a.action === 'DELETE') return 'Removed';
    const keys = Object.keys(a.new_data || {});
    return `Changed: ${keys.slice(0, 6).join(', ')}${keys.length > 6 ? '…' : ''}`;
  };
  const audit = d.audit ? section('Audit history', dataTable({
    rows: d.audit, pageSize: 10, empty: 'No audit entries.',
    columns: [{ key: 'at', label: 'When', render: (r) => fmtDateTime(r.at) },
      { key: 'table_name', label: 'Record' }, { key: 'action', label: 'Action' },
      { key: 'sum', label: 'Details', nosort: true, render: summarize },
      { key: 'actor', label: 'By', sort: (r) => d.people.get(r.actor) ?? '', render: (r) => (r.actor ? d.people.get(r.actor) ?? 'Unknown user' : 'System') }],
  })) : null;

  root.append(
    el('div', {}, el('a', { class: 'back-link', href: '#/technicians' }, '← Technicians'),
      el('div', { class: 'page-head' }, el('div', {}, el('h2', {}, name),
        el('div', { class: 'row', style: 'margin-top:6px' }, badge(t.employment_status, EMPLOYMENT_VARIANT[t.employment_status]),
          t.company?.name ? el('span', { class: 'muted' }, t.company.name) : null)))),
    profile, offense, el('div', { class: 'grid grid--2' }, training, trainingHistory), violations, retraining, offenseHistory, audit);
}
