import { el } from '../utils/dom.js';
import { dataTable } from '../ui/table.js';
import { badge } from '../ui/badge.js';
import { fetchAll, updateVersioned } from '../utils/db.js';
import { friendlyError } from '../utils/errors.js';
import { fmtDate, todayISO } from '../utils/dates.js';
import { toCSV, downloadCSV } from '../utils/csv.js';
import { loadXLSX } from '../import/sheetjs.js';
import { readSheet } from '../import/parse.js';
import { buildEmployeePlan } from '../import/employees.js';
import { lmsColumnAvailable } from '../utils/schema.js';

const MAX_BYTES = 10 * 1024 * 1024;
const lc = (s) => String(s ?? '').toLowerCase();
const SEV = { error: 'red', warning: 'amber', info: 'blue' };
const show = (f, v) => (v == null || v === '' ? '—' : f === 'date_hired' ? fmtDate(v) : String(v));

export async function renderImport(root, ctx) {
  if (!ctx.can('import:run')) { root.append(el('div', { class: 'card empty' }, el('h2', {}, 'Access restricted'), el('p', { class: 'muted' }, 'Only an admin can import employees.'))); return; }
  const { sb } = ctx;
  const S = { file: null, sheet: null, db: null, plan: null, createLookups: true, filter: 'all' };
  const host = el('div', { class: 'stack' });

  async function loadDb() {
    const lms = await lmsColumnAvailable(sb);
    const [techs, co, de, ac] = await Promise.all([
      fetchAll(() => sb.from('technicians').select(`id,name_key,employment_status,date_hired,mobile,email,version,${lms ? 'has_lms_account,' : ''}company:companies(name),designation:designations(name),technician_access(access_id)`).order('id')),
      sb.from('companies').select('id,name'), sb.from('designations').select('id,name'), sb.from('access_systems').select('id,name'),
    ]);
    for (const r of [co, de, ac]) if (r.error) throw r.error;
    return { lmsAvailable: lms, companies: co.data, designations: de.data, access: ac.data,
      techs: techs.map((t) => ({ ...t, company: t.company?.name ?? null, designation: t.designation?.name ?? null, accessIds: new Set(t.technician_access.map((a) => a.access_id)) })) };
  }
  const replan = () => { S.plan = buildEmployeePlan({ sheet: S.sheet, db: S.db, today: todayISO(), options: { createLookups: S.createLookups } }); };

  // ---------- step 1 ----------
  function stepFile(message = null) {
    const input = el('input', { class: 'input', type: 'file', accept: '.xlsx', 'aria-label': 'Employee Details workbook' });
    const note = el('div', { class: 'alert alert--error', role: 'alert', hidden: !message }, message ?? '');
    const btn = el('button', { class: 'btn btn--primary', type: 'button' }, 'Analyze file');
    btn.addEventListener('click', async () => {
      const f = input.files?.[0]; note.hidden = true;
      if (!f || !/\.xlsx$/i.test(f.name)) { note.textContent = 'Choose an .xlsx file.'; note.hidden = false; return; }
      if (f.size > MAX_BYTES) { note.textContent = 'The file is larger than 10 MB.'; note.hidden = false; return; }
      btn.disabled = true; btn.textContent = 'Analyzing…';
      try {
        const [XLSX, buf, db] = await Promise.all([loadXLSX(), f.arrayBuffer(), loadDb()]);
        const wb = XLSX.read(buf, { type: 'array', cellDates: false, cellFormula: false });
        const name = wb.SheetNames.find((s) => /employee/i.test(s)) ?? wb.SheetNames[0];
        S.file = f; S.db = db; S.sheet = readSheet(XLSX, wb, name, 'Name'); S.createLookups = true; S.filter = 'all';
        replan(); stepPreview();
      } catch (e) {
        console.error(e); btn.disabled = false; btn.textContent = 'Analyze file';
        note.textContent = /library|offline/i.test(e.message) ? e.message : `Could not read the file. ${friendlyError(e)}`; note.hidden = false;
      }
    });
    host.replaceChildren(el('div', { class: 'card stack' }, el('h3', {}, '1. Choose the Employee Details workbook'),
      el('p', { class: 'muted' }, 'Columns: Name, Designation, Company, Status, Date Hired, Mobile, Email, LMS User, SalesForce, WFM Mobile, Jo Mobile, Account Lookup. The file is read in your browser; nothing is saved until you confirm.'),
      el('p', { class: 'muted small' }, 'Employees are matched by name. Blank cells never erase data. Blank database values are filled automatically (you can untick them); differing values are shown as overwrites and are only applied if you tick them and confirm.'),
      note, input, el('div', {}, btn)));
  }

  // ---------- step 2 ----------
  function stepPreview() {
    const P = S.plan, st = P.stats;
    const matched = P.items.filter((i) => i.kind === 'match'), fresh = P.items.filter((i) => i.kind === 'new');
    const all = matched.flatMap((i) => i.changes.map((c) => ({ ...c, name: i.name, ref: c })));
    const info = el('div', { class: 'small muted' });
    const importBtn = el('button', { class: 'btn btn--primary', type: 'button' });
    const totals = () => {
      const on = all.filter((c) => c.ref.on), inc = fresh.filter((i) => i.include);
      const over = on.filter((c) => c.type === 'change').length;
      importBtn.textContent = `Import selected (${inc.length} new, ${on.length - over} fills, ${over} overwrites)`;
      importBtn.disabled = !inc.length && !on.length;
      return { on, inc, over };
    };
    fresh.forEach((i) => { if (i.include === undefined) i.include = !i.hold; });

    const needNames = [...P.need.designations.values(), ...P.need.companies.values(), ...[...P.need.access.values()].map((a) => `${a} (access)`)];
    const create = el('input', { type: 'checkbox', checked: S.createLookups });
    create.addEventListener('change', () => { S.createLookups = create.checked; replan(); stepPreview(); });

    const card = (t, v) => el('div', { class: 'card' }, el('div', { class: 'card__title' }, t), el('div', { class: 'stat' }, v));
    const cb = (c, on, fn, label) => { const i = el('input', { type: 'checkbox', checked: on, 'aria-label': label }); i.addEventListener('change', () => { fn(i.checked); totals(); }); return i; };

    const chHost = el('div', { class: 'card card--flush' });
    const paintChanges = () => {
      const rows = all.filter((c) => S.filter === 'all' || c.type === S.filter);
      chHost.replaceChildren(dataTable({ rows, pageSize: 25, empty: 'No differences in this view.',
        columns: [{ key: 'on', label: 'Apply', nosort: true, render: (r) => cb(r, r.ref.on, (v) => { r.ref.on = v; }, `Apply ${r.label} for ${r.name}`) },
          { key: 'name', label: 'Employee' }, { key: 'label', label: 'Field' },
          { key: 'from', label: 'Current', render: (r) => el('span', { class: r.type === 'change' ? 'diff-old' : 'muted' }, show(r.field, r.from)) },
          { key: 'to', label: 'From file', render: (r) => el('span', { class: 'diff-new' }, show(r.field, r.to)) },
          { key: 'type', label: 'Type', render: (r) => (r.type === 'fill' ? badge('Fill blank', 'green') : badge('Overwrite', 'amber')) }] }));
    };
    const filter = el('select', { class: 'input', 'aria-label': 'Change type' }, [['all', 'All differences'], ['fill', 'Safe fills only'], ['change', 'Overwrites only']].map(([v, t]) => el('option', { value: v }, t)));
    filter.value = S.filter; filter.addEventListener('input', () => { S.filter = filter.value; paintChanges(); });
    const bulk = (label, fn) => el('button', { class: 'btn btn--sm', type: 'button', onclick: () => { all.forEach((c) => fn(c.ref)); paintChanges(); totals(); } }, label);

    const newHost = el('div', { class: 'card card--flush' }, dataTable({ rows: fresh, pageSize: 10, empty: 'No new employees.',
      columns: [{ key: 'inc', label: 'Add', nosort: true, render: (i) => cb(i, i.include, (v) => { i.include = v; }, `Add ${i.name}`) },
        { key: 'name', label: 'Name' }, { key: 'sp', label: 'First / surname', nosort: true, render: (i) => `${i.split.first} / ${i.split.surname}` },
        { key: 'des', label: 'Designation', render: (i) => i.data.designation }, { key: 'co', label: 'Company', render: (i) => i.data.company },
        { key: 'status', label: 'Status', render: (i) => i.data.employment_status }, { key: 'hired', label: 'Hired', render: (i) => fmtDate(i.data.date_hired) },
        { key: 'hold', label: 'Review', nosort: true, render: (i) => (i.hold ? badge('Possible duplicate', 'amber') : '') }] }));

    const iss = P.issues.filter((i) => i.severity !== 'info');
    const issHost = el('div', { class: 'card card--flush' }, dataTable({ rows: iss, pageSize: 10, empty: 'No issues.',
      columns: [{ key: 'severity', label: 'Level', render: (i) => badge(i.severity, SEV[i.severity]) }, { key: 'row', label: 'Row' }, { key: 'field', label: 'Field' }, { key: 'message', label: 'Message', nosort: true }] }));

    importBtn.addEventListener('click', async () => {
      const { on, inc, over } = totals();
      const sample = on.filter((c) => c.type === 'change').slice(0, 5).map((c) => `${c.name}: ${c.label} ${show(c.field, c.from)} → ${show(c.field, c.to)}`).join('; ');
      const ok = await ctx.confirm({ title: over ? `Overwrite ${over} existing value${over === 1 ? '' : 's'}?` : 'Import employee data?', confirmText: 'Import', danger: over > 0,
        message: `${inc.length} new employee${inc.length === 1 ? '' : 's'}, ${on.length - over} blank value${on.length - over === 1 ? '' : 's'} filled${over ? `, ${over} existing value${over === 1 ? '' : 's'} OVERWRITTEN (${sample}${over > 5 ? '…' : ''})` : ''}.${needNames.length && S.createLookups ? ` Missing list entries will be created: ${needNames.join(', ')}.` : ''} Nothing is deleted and every change is audit-logged.` });
      if (ok) await stepCommit({ on, inc });
    });

    host.replaceChildren(
      el('div', { class: 'card stack' }, el('div', { class: 'row' }, el('h3', { class: 'grow' }, `2. Review – ${S.file.name}`),
        el('span', { class: 'row' }, badge(`${st.errors} errors`, st.errors ? 'red' : 'green'), badge(`${iss.length - st.errors} warnings`, iss.length - st.errors ? 'amber' : 'green'))),
        el('div', { class: 'grid grid--cards' }, card('Rows in file', st.rows), card('New employees', st.newRows), card('Existing with differences', st.updateRows), card('Already identical', st.sameRows)),
        el('label', { class: 'row small', style: 'gap:6px' }, create, needNames.length ? `Create missing list entries: ${needNames.join(', ')}` : 'Create missing companies, designations and access systems (none needed)'),
        P.notInFile.length ? el('p', { class: 'muted small' }, `${P.notInFile.length} existing employee${P.notInFile.length === 1 ? ' is' : 's are'} not in the file and stay unchanged.`) : null),
      el('div', { class: 'card stack' }, el('div', { class: 'row' }, el('h3', { class: 'grow' }, 'Differences for existing employees'), filter,
        bulk('Select safe fills', (c) => { c.on = c.type === 'fill'; }), bulk('Select none', (c) => { c.on = false; }), bulk('Select everything incl. overwrites', (c) => { c.on = true; })), chHost),
      fresh.length ? el('div', { class: 'card stack' }, el('h3', {}, 'New employees'), newHost) : null,
      iss.length ? el('div', { class: 'card stack' }, el('div', { class: 'row' }, el('h3', { class: 'grow' }, 'Issues'),
        el('button', { class: 'btn btn--sm', type: 'button', onclick: () => downloadCSV(`employee-import-issues-${todayISO()}.csv`, toCSV(
          [{ key: 'severity', label: 'Level' }, { key: 'row', label: 'Row' }, { key: 'field', label: 'Field' }, { key: 'message', label: 'Message' }], iss)) }, 'Download')), issHost) : null,
      el('div', { class: 'row' }, importBtn, el('button', { class: 'btn', type: 'button', onclick: () => stepFile() }, 'Start over')));
    paintChanges(); totals();
  }

  // ---------- step 3 ----------
  async function stepCommit({ on, inc }) {
    const bar = el('progress', { max: 100, value: 0, style: 'width:100%' }), label = el('p', { class: 'muted' }, 'Starting…');
    host.replaceChildren(el('div', { class: 'card stack' }, el('h3', {}, '3. Importing…'), bar, label, el('p', { class: 'muted small' }, 'Keep this tab open. If interrupted, analyze again: changes already applied show as identical.')));
    const R = { created: 0, filled: 0, overwritten: 0, failures: [] };
    const fail = (row, field, e) => R.failures.push({ row, field, message: typeof e === 'string' ? e : `${friendlyError(e)}${e?.message && e.code ? ` (${e.message})` : ''}` });
    try {
      const P = S.plan;
      const { data: batch, error: be } = await sb.from('import_batches').insert({ file_name: S.file.name.slice(0, 200), status: 'previewed', created_by: ctx.profile.user_id,
        summary: { kind: 'employee-details', new: inc.length, changes: on.length } }).select('id').single();
      if (be) throw be;

      if (S.createLookups) {
        const add = async (table, wanted) => {
          if (!wanted.length) return;
          const { data, error } = await sb.from(table).select('name'); if (error) throw error;
          const have = new Set(data.map((r) => lc(r.name).trim()));
          const rows = wanted.filter((n) => !have.has(lc(n))).map((name) => ({ name }));
          if (rows.length) { const { error: e } = await sb.from(table).insert(rows); if (e) throw e; }
        };
        await add('companies', [...P.need.companies.values()]); await add('designations', [...P.need.designations.values()]); await add('access_systems', [...P.need.access.values()]);
      }
      const ids = async (t) => { const { data, error } = await sb.from(t).select('id,name'); if (error) throw error; return new Map(data.map((r) => [lc(r.name), r.id])); };
      const [coId, deId, acId] = await Promise.all([ids('companies'), ids('designations'), ids('access_systems')]);
      const lms = S.db.lmsAvailable;

      const work = [...inc.map((i) => ({ t: 'new', i })), ...P.items.filter((i) => i.kind === 'match' && i.changes.some((c) => c.on)).map((i) => ({ t: 'upd', i }))];
      for (let k = 0; k < work.length; k++) {
        const { t, i } = work[k];
        label.textContent = `${t === 'new' ? 'Adding' : 'Updating'} ${i.name} (${k + 1} of ${work.length})`; bar.value = Math.round((100 * k) / work.length);
        try {
          if (t === 'new') {
            const d = i.data;
            const payload = { first_name: i.split.first, surname: i.split.surname, employment_status: d.employment_status, date_hired: d.date_hired, mobile: d.mobile, email: d.email,
              company_id: coId.get(lc(d.company)) ?? null, designation_id: deId.get(lc(d.designation)) ?? null, created_by: ctx.profile.user_id };
            if (lms) payload.has_lms_account = d.has_lms_account;
            const { data, error } = await sb.from('technicians').insert(payload).select('id').single();
            if (error) throw error;
            const links = d.access.filter((n) => acId.has(lc(n))).map((n) => ({ technician_id: data.id, access_id: acId.get(lc(n)) }));
            if (links.length) { const { error: e } = await sb.from('technician_access').insert(links); if (e) throw e; }
            R.created++;
          } else {
            const ch = i.changes.filter((c) => c.on), patch = {};
            for (const c of ch.filter((x) => !x.field.startsWith('access:'))) {
              if (c.field === 'designation') { if (deId.has(lc(c.to))) patch.designation_id = deId.get(lc(c.to)); else fail(i.row, c.label, 'List entry does not exist; skipped.'); }
              else if (c.field === 'company') { if (coId.has(lc(c.to))) patch.company_id = coId.get(lc(c.to)); else fail(i.row, c.label, 'List entry does not exist; skipped.'); }
              else if (c.field === 'has_lms_account') patch.has_lms_account = c.to === 'Yes';
              else patch[c.field] = c.to;
            }
            if (Object.keys(patch).length) await updateVersioned(sb, 'technicians', i.techId, i.version, patch);
            for (const c of ch.filter((x) => x.field.startsWith('access:'))) {
              const aid = acId.get(lc(c.accessName));
              if (!aid) { fail(i.row, c.label, 'Access system does not exist; skipped.'); continue; }
              const { error } = c.accessAdd
                ? await sb.from('technician_access').upsert({ technician_id: i.techId, access_id: aid }, { onConflict: 'technician_id,access_id', ignoreDuplicates: true })
                : await sb.from('technician_access').delete().eq('technician_id', i.techId).eq('access_id', aid);
              if (error) throw error;
            }
            R.filled += ch.filter((c) => c.type === 'fill').length; R.overwritten += ch.filter((c) => c.type === 'change').length;
          }
        } catch (e) { console.error(e); fail(i.row, null, e.code === 'CONFLICT' ? 'Changed by someone else since the preview. Analyze again.' : e); }
      }
      await sb.from('import_batches').update({ status: 'committed', committed_at: new Date().toISOString(),
        summary: { kind: 'employee-details', created: R.created, filled: R.filled, overwritten: R.overwritten, failures: R.failures.length } }).eq('id', batch.id);
      stepDone(R);
    } catch (e) {
      console.error(e);
      host.replaceChildren(el('div', { class: 'card stack' }, el('h3', {}, 'Import stopped'), el('div', { class: 'alert alert--error' }, friendlyError(e)),
        el('p', { class: 'muted small' }, 'Some changes may already be applied. Analyze the file again to see what remains.'), el('button', { class: 'btn', type: 'button', onclick: () => stepFile() }, 'Start over')));
    }
  }

  function stepDone(R) {
    host.replaceChildren(el('div', { class: 'card stack' }, el('h3', {}, R.failures.length ? 'Import finished with problems' : 'Import complete'),
      el('ul', { class: 'list' }, [['New employees', R.created], ['Blank values filled', R.filled], ['Existing values overwritten', R.overwritten]].map(([t, n]) => el('li', {}, el('span', {}, t), el('strong', {}, n)))),
      R.failures.length ? el('div', { class: 'stack' }, el('div', { class: 'alert alert--error' }, `${R.failures.length} item${R.failures.length === 1 ? '' : 's'} not applied.`),
        el('div', { class: 'card card--flush' }, dataTable({ rows: R.failures, pageSize: 10, columns: [{ key: 'row', label: 'Row' }, { key: 'field', label: 'Field' }, { key: 'message', label: 'Reason', nosort: true }] })),
        el('button', { class: 'btn btn--sm', type: 'button', onclick: () => downloadCSV(`employee-import-failures-${todayISO()}.csv`, toCSV([{ key: 'row', label: 'Row' }, { key: 'field', label: 'Field' }, { key: 'message', label: 'Reason' }], R.failures)) }, 'Download failure report')) : null,
      el('div', { class: 'row' }, el('a', { class: 'btn btn--primary', href: '#/technicians' }, 'Open Employee Directory'), el('button', { class: 'btn', type: 'button', onclick: () => stepFile() }, 'Import another file'))));
  }

  root.append(el('div', { class: 'page-head' }, el('div', {}, el('a', { class: 'back-link', href: '#/technicians' }, '← Employee Directory'), el('h2', {}, 'Import Employee Details'))), host);
  stepFile();
}
