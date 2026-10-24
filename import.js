import { el } from '../utils/dom.js';
import { dataTable } from '../ui/table.js';
import { badge } from '../ui/badge.js';
import { fetchAll } from '../utils/db.js';
import { friendlyError } from '../utils/errors.js';
import { todayISO } from '../utils/dates.js';
import { toCSV, downloadCSV } from '../utils/csv.js';
import { loadXLSX } from '../import/sheetjs.js';
import { readSheet, formulaErrors, buildPlan } from '../import/parse.js';
import { commitPlan } from '../import/commit.js';

const MAX_BYTES = 15 * 1024 * 1024;
const SETS = [['tech', 'Technicians'], ['training', 'Training records'], ['violations', 'QA violations'], ['retrainings', 'Retraining records']];
const SEV_VARIANT = { error: 'red', warning: 'amber', info: 'blue' };
const lc = (s) => String(s ?? '').toLowerCase();

export async function render(root, ctx) {
  if (!ctx.can('import:run')) { root.append(el('div', { class: 'card empty' }, el('h2', {}, 'Access restricted'))); return; }
  const { sb } = ctx;
  const S = { file: null, wb: null, sheets: null, lookups: null, plan: null, formulaErr: [], options: { createLookups: false }, include: { tech: true, training: true, violations: true, retrainings: true } };
  const host = el('div', { class: 'stack' });

  // ---------- existing data (for duplicate detection) ----------
  async function loadLookups() {
    const [co, de, ac, ty, ca, an, techs, tr, vi, re] = await Promise.all([
      ...['companies', 'designations', 'access_systems', 'training_types'].map((t) => sb.from(t).select('id,name')),
      sb.from('violation_categories').select('id,code,name'), sb.from('action_types').select('id,name'),
      fetchAll(() => sb.from('technicians').select('id,name_key').order('id')),
      fetchAll(() => sb.from('training_records').select('technician_id,training_type_id,completed_on').order('id')),
      fetchAll(() => sb.from('violations').select('id,technician_id,violation_date,description').order('id')),
      fetchAll(() => sb.from('retrainings').select('technician_id,training_type_id,retraining_date,violation_id').order('id')),
    ]);
    for (const r of [co, de, ac, ty, ca, an]) if (r.error) throw r.error;
    const keyOf = new Map(techs.map((t) => [t.id, t.name_key]));
    const typeName = new Map(ty.data.map((t) => [t.id, lc(t.name)]));
    const violDate = new Map(vi.map((v) => [v.id, v.violation_date]));
    return { companies: co.data, designations: de.data, access: ac.data, types: ty.data, categories: ca.data, actions: an.data,
      techKeys: new Map(techs.map((t) => [t.name_key, t.id])),
      existTraining: new Set(tr.map((r) => `${keyOf.get(r.technician_id)}|${typeName.get(r.training_type_id)}|${r.completed_on}`)),
      existViolations: new Set(vi.map((v) => `${keyOf.get(v.technician_id)}|${v.violation_date}|${lc(v.description).replace(/\s+/g, ' ').trim()}`)),
      existViolDates: new Set(vi.map((v) => `${keyOf.get(v.technician_id)}|${v.violation_date}`)),
      existRetrainings: new Set(re.map((r) => `${keyOf.get(r.technician_id)}|${typeName.get(r.training_type_id)}|${r.retraining_date ?? ''}|${r.violation_id ? violDate.get(r.violation_id) ?? '' : ''}`)) };
  }

  const replan = () => { S.plan = buildPlan({ sheets: S.sheets, lookups: S.lookups, options: S.options, today: todayISO() }); };

  // ---------- step 1: choose file ----------
  function stepFile(message = null) {
    const input = el('input', { class: 'input', type: 'file', accept: '.xlsx', 'aria-label': 'Excel workbook' });
    const btn = el('button', { class: 'btn btn--primary', type: 'button' }, 'Analyze workbook');
    const note = el('div', { class: 'alert alert--error', role: 'alert', hidden: !message }, message ?? '');
    btn.addEventListener('click', async () => {
      const f = input.files?.[0];
      note.hidden = true;
      if (!f) { note.textContent = 'Choose the .xlsx workbook first.'; note.hidden = false; return; }
      if (!/\.xlsx$/i.test(f.name)) { note.textContent = 'Only .xlsx files are supported.'; note.hidden = false; return; }
      if (f.size > MAX_BYTES) { note.textContent = 'The file is larger than 15 MB.'; note.hidden = false; return; }
      btn.disabled = true; btn.textContent = 'Analyzing…';
      try {
        const [XLSX, buf, lookups] = await Promise.all([loadXLSX(), f.arrayBuffer(), loadLookups()]);
        const wb = XLSX.read(buf, { type: 'array', cellDates: false, cellFormula: false });
        S.file = f; S.wb = wb; S.lookups = lookups; S.formulaErr = formulaErrors(XLSX, wb);
        S.sheets = { training: readSheet(XLSX, wb, 'Training Records', 'First Name'), violations: readSheet(XLSX, wb, 'Violation Records', 'Date of Violation'),
          retraining: readSheet(XLSX, wb, 'Retraining Records', 'Date of Violation') };
        replan(); stepPreview();
      } catch (e) {
        console.error(e);
        btn.disabled = false; btn.textContent = 'Analyze workbook';
        note.textContent = /library|offline/i.test(e.message) ? e.message : `Could not read the workbook. ${friendlyError(e)}`; note.hidden = false;
      }
    });
    host.replaceChildren(el('div', { class: 'card stack' },
      el('h3', {}, '1. Choose your workbook'),
      el('p', { class: 'muted' }, 'The file is read in your browser and nothing is saved until you confirm on the next screen. Existing records are never changed or deleted: anything already in the system is skipped.'),
      el('p', { class: 'muted small' }, 'Imported: Training Records (technicians and training dates), Violation Records and Retraining Records. Not imported: Dashboard totals and the calculated offense columns, which are recalculated from the data.'),
      note, input, el('div', {}, btn)));
  }

  // ---------- step 2: preview ----------
  function stepPreview() {
    const P = S.plan;
    const willImport = (k) => (S.include[k] ? P[k].items.length : 0);
    const total = SETS.reduce((n, [k]) => n + willImport(k), 0);

    const summary = dataTable({ pageSize: 10, rows: SETS.map(([k, label]) => ({ k, label, file: P[k].total, imp: willImport(k), dup: P[k].dup, err: P[k].err })),
      columns: [{ key: 'label', label: 'Data', nosort: true },
        { key: 'file', label: 'Rows in workbook', nosort: true }, { key: 'imp', label: 'Will be imported', nosort: true, render: (r) => badge(String(r.imp), r.imp ? 'green' : '') },
        { key: 'dup', label: 'Already exist (skipped)', nosort: true }, { key: 'err', label: 'Excluded (errors)', nosort: true, render: (r) => (r.err ? badge(String(r.err), 'red') : '0') }] });

    const checks = el('div', { class: 'row' }, SETS.map(([k, label]) => {
      const cb = el('input', { type: 'checkbox', checked: S.include[k] });
      cb.addEventListener('change', () => { S.include[k] = cb.checked; stepPreview(); });
      return el('label', { class: 'row small', style: 'gap:6px' }, cb, `Import ${label.toLowerCase()}`);
    }));
    const create = el('input', { type: 'checkbox', checked: S.options.createLookups });
    create.addEventListener('change', () => { S.options.createLookups = create.checked; replan(); stepPreview(); });

    const c = P.completeness;
    const sevCount = (s) => P.issues.filter((i) => i.severity === s).length;
    const fe = S.formulaErr.length ? el('div', { class: 'alert alert--info' },
      `Formula errors found (${S.formulaErr.map((f) => `${f.sheet}: ${f.n} cells`).join(', ')}). The workbook's calculated columns are broken, so they are ignored; offense levels are recalculated from the violation data.`) : null;

    const sevSel = el('select', { class: 'input', 'aria-label': 'Severity filter' },
      [['issues', 'Errors and warnings'], ['error', 'Errors only'], ['info', 'Everything']].map(([v, t]) => el('option', { value: v }, t)));
    const issuesHost = el('div', { class: 'card card--flush' });
    const paintIssues = () => {
      const rows = P.issues.filter((i) => (sevSel.value === 'info' ? true : sevSel.value === 'error' ? i.severity === 'error' : i.severity !== 'info'));
      issuesHost.replaceChildren(dataTable({ rows, pageSize: 15, empty: 'No issues in this view.',
        columns: [{ key: 'severity', label: 'Level', render: (i) => badge(i.severity, SEV_VARIANT[i.severity]) }, { key: 'sheet', label: 'Sheet' },
          { key: 'row', label: 'Row' }, { key: 'field', label: 'Field' }, { key: 'message', label: 'Message', nosort: true }] }));
    };
    sevSel.addEventListener('input', paintIssues);
    paintIssues();

    const go = async () => {
      if (!(await ctx.confirm({ title: 'Import into the live database?', confirmText: 'Import',
        message: `This adds ${total} record${total === 1 ? '' : 's'} (${SETS.map(([k, l]) => `${willImport(k)} ${l.toLowerCase()}`).join(', ')}). Nothing existing is changed or deleted. The import is logged in the audit trail.` }))) return;
      await stepCommit();
    };

    host.replaceChildren(
      el('div', { class: 'card stack' }, el('div', { class: 'row' }, el('h3', { class: 'grow' }, `2. Preview – ${S.file.name}`),
        el('span', { class: 'row' }, badge(`${sevCount('error')} errors`, sevCount('error') ? 'red' : 'green'), badge(`${sevCount('warning')} warnings`, sevCount('warning') ? 'amber' : 'green'))),
        el('p', { class: 'muted small' }, 'Rows with errors are excluded; warnings are imported with the noted adjustment. Fix the workbook and re-analyze to include excluded rows.'),
        fe, el('div', { class: 'card card--flush' }, summary), checks,
        el('label', { class: 'row small', style: 'gap:6px' }, create, 'Create missing companies, designations, access systems and violation categories (otherwise they are left blank or the row is excluded)'),
        el('p', { class: 'muted small' }, `New technicians missing: birthdate ${c.birthdate}, date hired ${c.hired}, email ${c.email}, mobile ${c.mobile} (of ${c.technicians}). They can be completed later.`)),
      el('div', { class: 'card stack' }, el('div', { class: 'row' }, el('h3', { class: 'grow' }, 'Issues'), sevSel,
        el('button', { class: 'btn btn--sm', type: 'button', onclick: () => downloadCSV(`import-issues-${todayISO()}.csv`, toCSV(
          [{ key: 'severity', label: 'Level' }, { key: 'sheet', label: 'Sheet' }, { key: 'row', label: 'Row' }, { key: 'field', label: 'Field' }, { key: 'message', label: 'Message' }], P.issues)) }, 'Download issue report')),
        issuesHost),
      el('div', { class: 'row' }, el('button', { class: 'btn btn--primary', type: 'button', disabled: !total, onclick: go }, `Import ${total} record${total === 1 ? '' : 's'}`),
        el('button', { class: 'btn', type: 'button', onclick: () => stepFile() }, 'Start over')));
  }

  // ---------- step 3: commit ----------
  async function stepCommit() {
    const bar = el('progress', { max: 100, value: 0, style: 'width:100%' });
    const label = el('p', { class: 'muted' }, 'Starting…');
    host.replaceChildren(el('div', { class: 'card stack' }, el('h3', {}, '3. Importing…'), bar, label,
      el('p', { class: 'muted small' }, 'Keep this tab open until it finishes. If it is interrupted, run the import again: records already imported are skipped.')));
    try {
      const R = await commitPlan(ctx, S.plan, { include: S.include, fileName: S.file.name }, ({ phase, done, total }) => {
        label.textContent = `${phase}: ${done} of ${total}`; bar.value = total ? Math.round((100 * done) / total) : 0;
      });
      stepDone(R);
    } catch (e) {
      console.error(e);
      host.replaceChildren(el('div', { class: 'card stack' }, el('h3', {}, 'Import stopped'), el('div', { class: 'alert alert--error' }, friendlyError(e)),
        el('p', { class: 'muted small' }, 'Some records may already have been added. Analyze the workbook again to see what remains; existing records are skipped.'),
        el('button', { class: 'btn', type: 'button', onclick: () => stepFile() }, 'Start over')));
    }
  }

  function stepDone(R) {
    const list = [['Technicians', R.tech], ['Training records', R.training], ['QA violations', R.violations], ['Evidence links', R.evidence], ['Retraining records', R.retrainings]];
    host.replaceChildren(el('div', { class: 'card stack' },
      el('h3', {}, R.failures.length ? 'Import finished with problems' : 'Import complete'),
      el('ul', { class: 'list' }, list.map(([t, n]) => el('li', {}, el('span', {}, t), el('strong', {}, n)))),
      R.failures.length ? el('div', { class: 'stack' }, el('div', { class: 'alert alert--error' }, `${R.failures.length} item${R.failures.length === 1 ? '' : 's'} could not be imported.`),
        el('div', { class: 'card card--flush' }, dataTable({ rows: R.failures, pageSize: 10, columns: [{ key: 'sheet', label: 'Sheet' }, { key: 'row', label: 'Row' }, { key: 'field', label: 'Field' }, { key: 'message', label: 'Reason', nosort: true }] })),
        el('div', {}, el('button', { class: 'btn btn--sm', type: 'button', onclick: () => downloadCSV(`import-failures-${todayISO()}.csv`, toCSV(
          [{ key: 'sheet', label: 'Sheet' }, { key: 'row', label: 'Row' }, { key: 'field', label: 'Field' }, { key: 'message', label: 'Reason' }], R.failures)) }, 'Download failure report'))) : null,
      el('div', { class: 'row' }, el('a', { class: 'btn btn--primary', href: '#/technicians' }, 'View technicians'), el('button', { class: 'btn', type: 'button', onclick: () => stepFile() }, 'Import another file'))));
  }

  root.append(el('div', { class: 'page-head' }, el('div', {}, el('h2', {}, 'Excel Import'),
    el('p', { class: 'muted small' }, 'Validate, preview and import data from the AHBA QA and Training workbook.'))), host);
  stepFile();
}
