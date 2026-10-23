import { el } from '../utils/dom.js';
import { dataTable } from '../ui/table.js';
import { fetchAll } from '../utils/db.js';
import { friendlyError } from '../utils/errors.js';
import { fmtDate, fmtDateTime, todayISO } from '../utils/dates.js';
import { toCSV, downloadCSV } from '../utils/csv.js';
import { ACTIVE, trainingSummary } from '../utils/metrics.js';
import { ordinal } from '../utils/validate.js';

const nm = (t) => (t ? `${t.first_name} ${t.surname}` : '');
const codes = (links) => (links || []).map((l) => l.violation_categories?.code).filter(Boolean).join('; ');
const show = (v) => (v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

const OPTIONS = {
  scope: [['active', 'Active staff'], ['all', 'All technicians']],
  vstatus: ['Open', 'For Retraining', 'Closed'].map((x) => [x, x]),
  severity: ['Minor', 'Major', 'Critical'].map((x) => [x, x]),
  outcome: ['Pending', 'Passed', 'Failed'].map((x) => [x, x]),
  mstatus: ['UNDER MONITORING', 'BANNED', 'CLEARED', 'No offense'].map((x) => [x, x]),
};
const FILTER_LABEL = { company: 'Company', from: 'From', to: 'To', scope: 'Staff', ttype: 'Training', vstatus: 'Status', severity: 'Severity', outcome: 'Outcome', mstatus: 'Monitoring', technician: 'Technician' };

export async function render(root, ctx) {
  const { sb } = ctx;
  let L;
  try {
    const [co, tt, techs, prof] = await Promise.all([
      sb.from('companies').select('id,name').order('name'),
      sb.from('training_types').select('id,name,required').eq('active', true).order('sort_order').order('id'),
      fetchAll(() => sb.from('technicians').select('id,first_name,surname,employment_status,company_id,company:companies(name),designation:designations(name)').order('surname').order('first_name').order('id')),
      sb.from('profiles').select('user_id,full_name'),
    ]);
    for (const r of [co, tt, prof]) if (r.error) throw r.error;
    L = { companies: co.data, types: tt.data, techs, people: new Map(prof.data.map((p) => [p.user_id, p.full_name])),
      techById: new Map(techs.map((t) => [t.id, t])), coName: new Map(co.data.map((c) => [c.id, c.name])) };
  } catch (e) {
    console.error(e);
    root.append(el('div', { class: 'alert alert--error' }, friendlyError(e)));
    return;
  }

  const range = (q, col, F) => { if (F.from) q = q.gte(col, F.from); if (F.to) q = q.lte(col, F.to); return q; };

  // Each report: filters it uses, and run(F) -> { columns:[{key,label,date?,datetime?}], rows:[plain objects] }
  const REPORTS = [
    { id: 'training-status', label: 'Training completion status', filters: ['company', 'scope'],
      desc: 'Required-training completion per technician, with the trainings still missing.',
      async run(F) {
        const [recs] = await Promise.all([fetchAll(() => sb.from('training_records').select('technician_id,training_type_id').order('id'))]);
        const list = L.techs.filter((t) => (F.scope === 'all' || ACTIVE.includes(t.employment_status)) && (!F.company || String(t.company_id) === F.company));
        const ts = trainingSummary(list, L.types, recs);
        return { columns: [{ key: 'technician', label: 'Technician' }, { key: 'company', label: 'Company' }, { key: 'designation', label: 'Designation' },
          { key: 'status', label: 'Employment status' }, { key: 'completed', label: 'Required completed' }, { key: 'total', label: 'Required total' },
          { key: 'pct', label: 'Completion %' }, { key: 'missing', label: 'Missing trainings' }],
        rows: list.map((t) => { const p = ts.per.get(t.id); const total = ts.req.length;
          return { technician: nm(t), company: t.company?.name, designation: t.designation?.name, status: t.employment_status,
            completed: p.completed.length, total, pct: total ? Math.round((100 * p.completed.length) / total) : 0, missing: p.missing.map((m) => m.name).join('; ') }; }) };
      } },
    { id: 'training-log', label: 'Training completions', filters: ['company', 'from', 'to', 'ttype'],
      desc: 'Every training completion recorded in the period.',
      async run(F) {
        const data = await fetchAll(() => {
          let q = sb.from('training_records').select('completed_on,trainer,remarks,training_types(name),technician:technicians!inner(first_name,surname,company_id)');
          if (F.company) q = q.eq('technician.company_id', F.company);
          if (F.ttype) q = q.eq('training_type_id', F.ttype);
          return range(q, 'completed_on', F).order('completed_on', { ascending: false }).order('id');
        });
        return { columns: [{ key: 'date', label: 'Date completed', date: true }, { key: 'technician', label: 'Technician' }, { key: 'company', label: 'Company' },
          { key: 'training', label: 'Training' }, { key: 'trainer', label: 'Trainer' }, { key: 'remarks', label: 'Remarks' }],
        rows: data.map((r) => ({ date: r.completed_on, technician: nm(r.technician), company: L.coName.get(r.technician.company_id), training: r.training_types?.name, trainer: r.trainer, remarks: r.remarks })) };
      } },
    { id: 'violations', label: 'QA violations', filters: ['company', 'from', 'to', 'vstatus', 'severity'],
      desc: 'QA findings in the period with category, severity, status and evidence count.',
      async run(F) {
        const data = await fetchAll(() => {
          let q = sb.from('violations').select('violation_date,severity,status,retraining_required,description,corrective_action,reported_by,ibas_no,jo_number,action:action_types(name),technician:technicians!inner(first_name,surname,company_id),violation_category_links(violation_categories(code)),violation_evidence(id)');
          if (F.company) q = q.eq('technician.company_id', F.company);
          if (F.vstatus) q = q.eq('status', F.vstatus);
          if (F.severity) q = q.eq('severity', F.severity);
          return range(q, 'violation_date', F).order('violation_date', { ascending: false }).order('id');
        });
        return { columns: [{ key: 'date', label: 'Date', date: true }, { key: 'technician', label: 'Technician' }, { key: 'company', label: 'Company' },
          { key: 'categories', label: 'Categories' }, { key: 'severity', label: 'Severity' }, { key: 'status', label: 'Status' },
          { key: 'counts', label: 'Counts as offense' }, { key: 'action', label: 'Action taken' }, { key: 'reported_by', label: 'Reported by' },
          { key: 'ibas', label: 'IBAS no.' }, { key: 'jo', label: 'JO number' }, { key: 'evidence', label: 'Evidence items' },
          { key: 'description', label: 'Description' }, { key: 'corrective', label: 'Corrective action' }],
        rows: data.map((r) => ({ date: r.violation_date, technician: nm(r.technician), company: L.coName.get(r.technician.company_id), categories: codes(r.violation_category_links),
          severity: r.severity, status: r.status, counts: r.retraining_required ? 'Yes' : 'No', action: r.action?.name, reported_by: r.reported_by, ibas: r.ibas_no, jo: r.jo_number,
          evidence: r.violation_evidence.length, description: r.description, corrective: r.corrective_action })) };
      } },
    { id: 'retraining', label: 'Retraining', filters: ['company', 'from', 'to', 'outcome'],
      desc: 'Retraining assignments and outcomes. A date range filters on the retraining date.',
      async run(F) {
        const data = await fetchAll(() => {
          let q = sb.from('retrainings').select('retraining_date,result,trainer,remarks,manual_reason,created_at,training_types(name),violation:violations(violation_date),technician:technicians!inner(first_name,surname,company_id)');
          if (F.company) q = q.eq('technician.company_id', F.company);
          if (F.outcome) q = q.eq('result', F.outcome);
          return range(q, 'retraining_date', F).order('created_at', { ascending: false }).order('id');
        });
        return { columns: [{ key: 'assigned', label: 'Assigned', date: true }, { key: 'technician', label: 'Technician' }, { key: 'company', label: 'Company' },
          { key: 'training', label: 'Training' }, { key: 'violation', label: 'Linked violation date', date: true }, { key: 'manual', label: 'Manual reason' },
          { key: 'date', label: 'Retraining date', date: true }, { key: 'trainer', label: 'Trainer' }, { key: 'result', label: 'Outcome' }, { key: 'remarks', label: 'Remarks' }],
        rows: data.map((r) => ({ assigned: r.created_at.slice(0, 10), technician: nm(r.technician), company: L.coName.get(r.technician.company_id), training: r.training_types?.name,
          violation: r.violation?.violation_date, manual: r.manual_reason, date: r.retraining_date, trainer: r.trainer, result: r.result, remarks: r.remarks })) };
      } },
    { id: 'offense-status', label: 'Offense monitoring status', filters: ['company', 'mstatus'],
      desc: 'Current monitoring, penalty and deployment eligibility per technician.',
      async run(F) {
        const data = await fetchAll(() => sb.from('v_offense_status').select('*').order('full_name').order('technician_id'));
        const co = F.company ? L.coName.get(Number(F.company)) : null;
        return { columns: [{ key: 'full_name', label: 'Technician' }, { key: 'company', label: 'Company' }, { key: 'designation', label: 'Designation' },
          { key: 'employment_status', label: 'Employment status' }, { key: 'monitoring_status', label: 'Monitoring' }, { key: 'offense', label: 'Current offense' },
          { key: 'monitoring_until', label: 'Monitoring until', date: true }, { key: 'current_penalty', label: 'Current penalty' }, { key: 'hold_until', label: 'Hold until', date: true },
          { key: 'deployment_status', label: 'Deployment' }, { key: 'eligible', label: 'Deployable' }, { key: 'review', label: 'Needs review' }, { key: 'review_reason', label: 'Review reason' }],
        rows: data.filter((r) => (!co || r.company === co) && (!F.mstatus || r.monitoring_status === F.mstatus)).map((r) => ({
          ...r, offense: r.current_offense_no ? ordinal(r.current_offense_no) : '', monitoring_until: r.current_offense_no ? r.monitoring_until : null,
          eligible: r.deployment_eligible ? 'Yes' : 'No', review: r.requires_review ? 'Yes' : 'No' })) };
      } },
    { id: 'offense-history', label: 'Offense history', filters: ['company', 'from', 'to'],
      desc: 'Each counted offense with its penalty and approval status.',
      async run(F) {
        const data = await fetchAll(() => range(sb.from('v_offense_history').select('*'), 'offense_date', F).order('offense_date', { ascending: false }).order('technician_id'));
        return { columns: [{ key: 'date', label: 'Offense date', date: true }, { key: 'technician', label: 'Technician' }, { key: 'company', label: 'Company' },
          { key: 'level', label: 'Offense' }, { key: 'severity', label: 'Severity' }, { key: 'violations', label: 'Violations that day' }, { key: 'penalty', label: 'Penalty' },
          { key: 'hold', label: 'Hold until', date: true }, { key: 'approval', label: 'Approval' }],
        rows: data.map((r) => ({ r, t: L.techById.get(r.technician_id) })).filter((x) => !F.company || String(x.t?.company_id) === F.company).map(({ r, t }) => ({
          date: r.offense_date, technician: nm(t), company: t?.company?.name, level: ordinal(r.offense_no), severity: r.severity_group, violations: r.violations_count,
          penalty: r.penalty, hold: r.hold_until, approval: r.approval_status ?? 'not required' })) };
      } },
  ];
  if (ctx.can('audit:view')) {
    REPORTS.push({ id: 'audit', label: 'Technician audit history', filters: ['technician', 'from', 'to'],
      desc: 'Every recorded change to a technician and their training, violations, retraining and approvals.',
      async run(F) {
        if (!F.technician) throw new Error('Choose a technician.');
        const data = await fetchAll(() => {
          let q = sb.from('audit_log').select('at,table_name,action,old_data,new_data,actor').eq('technician_id', F.technician);
          if (F.from) q = q.gte('at', `${F.from}T00:00:00+08:00`);
          if (F.to) q = q.lte('at', `${F.to}T23:59:59+08:00`);
          return q.order('at', { ascending: false }).order('id');
        });
        const changes = (a) => (a.action === 'INSERT' ? 'Created' : a.action === 'DELETE' ? 'Removed'
          : Object.keys(a.new_data || {}).map((k) => `${k}: ${show(a.old_data?.[k])} → ${show(a.new_data[k])}`).join('; '));
        return { columns: [{ key: 'at', label: 'When', datetime: true }, { key: 'record', label: 'Record' }, { key: 'action', label: 'Action' },
          { key: 'changes', label: 'Changes' }, { key: 'by', label: 'By' }],
        rows: data.map((a) => ({ at: a.at, record: a.table_name, action: a.action, changes: changes(a), by: a.actor ? (L.people.get(a.actor) ?? 'Unknown user') : 'System' })) };
      } });
  }

  // ---------- UI ----------
  const F = { scope: 'active' };
  let current = REPORTS[0], result = null;
  const ctrlHost = el('div', { class: 'toolbar' });
  const out = el('div');
  const desc = el('p', { class: 'muted small' });
  const picker = el('select', { class: 'input', 'aria-label': 'Report' }, REPORTS.map((r) => el('option', { value: r.id }, r.label)));
  const csvBtn = el('button', { class: 'btn', type: 'button', disabled: true }, 'Download CSV');
  const runBtn = el('button', { class: 'btn btn--primary', type: 'button' }, 'Generate');

  const optionsFor = (key) => {
    if (key === 'company') return L.companies.map((c) => [c.id, c.name]);
    if (key === 'ttype') return L.types.map((t) => [t.id, t.name]);
    if (key === 'technician') return L.techs.map((t) => [t.id, `${t.surname}, ${t.first_name}`]);
    return OPTIONS[key];
  };
  function buildControls() {
    ctrlHost.replaceChildren(...current.filters.map((key) => {
      if (key === 'from' || key === 'to') {
        const i = el('input', { class: 'input', type: 'date', max: todayISO(), value: F[key] ?? '' });
        i.addEventListener('input', () => { F[key] = i.value; });
        return el('label', { class: 'row small' }, FILTER_LABEL[key], i);
      }
      const s = el('select', { class: 'input', 'aria-label': FILTER_LABEL[key] },
        key === 'scope' ? null : el('option', { value: '' }, key === 'technician' ? 'Select technician…' : `All ${FILTER_LABEL[key].toLowerCase()}`),
        optionsFor(key).map(([v, t]) => el('option', { value: String(v) }, t)));
      s.value = F[key] ?? '';
      s.addEventListener('input', () => { F[key] = s.value; });
      return s;
    }));
    desc.textContent = current.desc;
  }

  async function generate() {
    if (F.from && F.to && F.from > F.to) return ctx.toast('The start date is after the end date.', 'error');
    runBtn.disabled = true; csvBtn.disabled = true;
    out.replaceChildren(el('div', { class: 'card' }, el('div', { class: 'skeleton' })));
    try {
      const { columns, rows } = await current.run(F);
      result = { columns, rows, id: current.id };
      const shown = columns.map((c) => (c.date ? { ...c, render: (r) => fmtDate(r[c.key]) } : c.datetime ? { ...c, render: (r) => fmtDateTime(r[c.key]) } : c));
      out.replaceChildren(el('div', { class: 'small muted', style: 'margin-bottom:8px' }, `${rows.length} row${rows.length === 1 ? '' : 's'}`),
        el('div', { class: 'card card--flush' }, dataTable({ columns: shown, rows, pageSize: 50, empty: 'No data for these filters.' })));
      csvBtn.disabled = !rows.length;
    } catch (e) {
      console.error(e);
      result = null;
      out.replaceChildren(el('div', { class: 'alert alert--error' }, e.message === 'Choose a technician.' ? e.message : friendlyError(e)));
    } finally { runBtn.disabled = false; }
  }

  picker.addEventListener('input', () => {
    current = REPORTS.find((r) => r.id === picker.value);
    for (const k of Object.keys(F)) if (!current.filters.includes(k)) delete F[k];
    if (current.filters.includes('scope')) F.scope ??= 'active';
    result = null; csvBtn.disabled = true; out.replaceChildren(); buildControls();
  });
  runBtn.addEventListener('click', generate);
  csvBtn.addEventListener('click', () => {
    if (!result) return;
    downloadCSV(`ahba-${result.id}-${todayISO()}.csv`, toCSV(result.columns, result.rows));
  });

  root.append(
    el('div', { class: 'page-head' }, el('div', {}, el('h2', {}, 'Reports'), desc)),
    el('div', { class: 'toolbar' }, picker, runBtn, csvBtn), ctrlHost, out);
  buildControls();
}
