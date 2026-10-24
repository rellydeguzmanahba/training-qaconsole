// Pure functions: workbook rows -> validated import plan. No network, no DOM (unit-testable).
import { nameKey, isEmail, isMobile } from '../utils/validate.js';

const STATUS = ['Applicant', 'Probationary', 'Regular', 'Resigned', 'Terminated'];
const SEVERITY = ['Minor', 'Major', 'Critical'];
const VSTATUS = ['Open', 'For Retraining', 'Closed'];
const RESULT = ['Pending', 'Passed', 'Failed'];

export const clean = (v) => (v == null ? null : (String(v).replace(/[\u00a0]/g, ' ').replace(/\s+/g, ' ').trim() || null));
const lc = (v) => clean(v)?.toLowerCase() ?? null;
const hyphen = (v) => clean(String(v ?? '').replace(/[\u2013\u2014]/g, '-'));
const canon = (list, v) => list.find((x) => x.toLowerCase() === lc(v)) ?? null;

// Excel serial number / ISO text -> 'YYYY-MM-DD'. Returns { iso, bad }.
export function toISODate(v) {
  if (v == null || v === '') return { iso: null, bad: false };
  if (typeof v === 'number' && v > 20000 && v < 80000) return { iso: new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10), bad: false };
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v).trim());
  if (m && !Number.isNaN(Date.parse(`${m[1]}-${m[2]}-${m[3]}`))) return { iso: `${m[1]}-${m[2]}-${m[3]}`, bad: false };
  return { iso: null, bad: true };
}

// Locate a header row (first 12 rows) containing `probe`; returns { rows:[{n,c}], hdr:[lowercased headers] }.
export function readSheet(XLSX, wb, name, probe) {
  const sheetName = wb.SheetNames.find((s) => s.toLowerCase() === name.toLowerCase());
  if (!sheetName) return null;
  const ws = wb.Sheets[sheetName];
  const offset = XLSX.utils.decode_range(ws['!ref'] || 'A1').s.r;
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  const h = aoa.slice(0, 12).findIndex((r) => r.some((c) => lc(c) === probe.toLowerCase()));
  if (h < 0) return { missingHeader: true };
  return { hdr: aoa[h].map((c) => lc(c)), rawHdr: aoa[h].map((c) => clean(c)), rows: aoa.slice(h + 1).map((c, i) => ({ n: offset + h + i + 2, c })) };
}

// Count Excel error cells (#REF! etc.) per sheet so the user knows calculated columns were broken.
export function formulaErrors(XLSX, wb) {
  const out = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    let n = 0;
    for (const k of Object.keys(ws)) if (k[0] !== '!' && ws[k]?.t === 'e') n++;
    if (n) out.push({ sheet: name, n });
  }
  return out;
}

const colOf = (hdr, prefix) => hdr.findIndex((h) => h && h.startsWith(prefix));

export function buildPlan({ sheets, lookups: L, options = {}, today }) {
  const issues = [];
  const issue = (severity, sheet, row, field, message) => issues.push({ severity, sheet, row, field, message });
  const need = { companies: new Map(), designations: new Map(), access: new Map(), categories: new Map() };
  const byName = (list) => new Map(list.map((x) => [lc(x.name), x]));
  const companies = byName(L.companies), designations = byName(L.designations), accessSys = byName(L.access);
  const types = byName(L.types), actions = byName(L.actions);
  const catByFull = new Map(), catByCode = new Map();
  for (const c of L.categories) {
    catByFull.set(lc(hyphen(`${c.code} - ${c.name}`)), c);
    const k = lc(hyphen(c.code));
    catByCode.set(k, [...(catByCode.get(k) || []), c]);
  }

  const plan = { tech: { items: [], dup: 0, err: 0, total: 0 }, training: { items: [], dup: 0, err: 0, total: 0 },
    violations: { items: [], dup: 0, err: 0, total: 0 }, retrainings: { items: [], dup: 0, err: 0, total: 0 },
    issues, need, completeness: { technicians: 0, birthdate: 0, hired: 0, email: 0, mobile: 0 } };

  const lookup = (map, raw, kind, sheet, row, field, label) => {
    const v = clean(raw);
    if (!v) return null;
    const hit = map.get(v.toLowerCase());
    if (hit) return hit.name;
    if (options.createLookups) { need[kind].set(v.toLowerCase(), v); issue('info', sheet, row, field, `${label} "${v}" will be created.`); return v; }
    issue('warning', sheet, row, field, `${label} "${v}" is not in the system list${kind === 'access' ? '; skipped.' : '; left blank.'}`);
    return null;
  };

  // ---------------- Technicians + training ----------------
  const stagedKeys = new Set(), okKeys = new Set(L.techKeys.keys());
  const tr = sheets.training;
  if (!tr) issue('error', 'Training Records', null, null, 'Sheet "Training Records" was not found; technicians and training cannot be imported.');
  else if (tr.missingHeader) issue('error', 'Training Records', null, null, 'Header row with "First Name" was not found.');
  else {
    const S = 'Training Records', h = tr.hdr;
    const ci = Object.fromEntries(['first name', 'middle name', 'surname', 'birthdate', 'date hired', 'company', 'mobile', 'email', 'designation', 'status',
      'account access', 'lms user', 'log in', 'date separated', 'separation reason'].map((k) => [k, colOf(h, k)]));
    const from = ci.status + 1, to = ci['account access'];
    const trainCols = [];
    for (let i = from; i < to; i++) {
      const name = clean(h[i] ? tr.rawHdr?.[i] ?? h[i] : null);
      if (!name || name.startsWith('(')) continue;
      const t = types.get(name.toLowerCase());
      if (t) trainCols.push({ i, type: t.name });
      else issue('warning', S, null, name, `Training column "${name}" is not a configured training type; its dates are ignored.`);
    }
    const cell = (c, k) => (ci[k] >= 0 ? c[ci[k]] : null);

    for (const { n, c } of tr.rows) {
      const first = clean(cell(c, 'first name')), sur = clean(cell(c, 'surname'));
      if (!first && !sur) continue;
      plan.tech.total++;
      if (!first || !sur) { plan.tech.err++; issue('error', S, n, !first ? 'First Name' : 'Surname', 'First name and surname are both required.'); continue; }
      const key = nameKey(first, sur);
      if (stagedKeys.has(key)) { plan.tech.dup++; issue('warning', S, n, 'Name', `"${first} ${sur}" appears more than once in the workbook; this row is skipped.`); continue; }
      stagedKeys.add(key);

      let bad = false;
      const err = (field, msg) => { bad = true; issue('error', S, n, field, msg); };
      const date = (k, label) => { const d = toISODate(cell(c, k)); if (d.bad) { issue('warning', S, n, label, 'Unrecognised date; left blank.'); } return d.iso; };
      let birthdate = date('birthdate', 'Birthdate'), hired = date('date hired', 'Date Hired'), separated = date('date separated', 'Date Separated');
      if (birthdate && (birthdate < '1900-01-01' || birthdate >= today)) { issue('warning', S, n, 'Birthdate', `Invalid birthdate ${birthdate}; left blank.`); birthdate = null; }
      if (hired && hired > today) { issue('warning', S, n, 'Date Hired', `Date hired ${hired} is in the future; left blank.`); hired = null; }
      if (separated && separated > today) { issue('warning', S, n, 'Date Separated', 'Separation date is in the future; left blank.'); separated = null; }
      if (hired && separated && separated < hired) err('Date Separated', 'Date separated is before the date hired.');

      const status = canon(STATUS, cell(c, 'status'));
      if (!status) err('Status', `Unknown employment status "${clean(cell(c, 'status')) ?? ''}".`);
      if (status && ['Resigned', 'Terminated'].includes(status) && !separated) issue('warning', S, n, 'Date Separated', `${status} technician has no separation date.`);
      if (status === 'Probationary' && !hired) issue('warning', S, n, 'Date Hired', 'Probationary technician has no hire date.');

      const mobRaw = cell(c, 'mobile');
      if (typeof mobRaw === 'number') issue('warning', S, n, 'Mobile Number', 'Stored as a number in Excel; a leading zero may be missing.');
      let mobile = clean(typeof mobRaw === 'number' ? String(mobRaw) : mobRaw);
      if (mobile && !isMobile(mobile)) { issue('warning', S, n, 'Mobile Number', `"${mobile}" is not a valid mobile number; left blank.`); mobile = null; }
      let email = lc(cell(c, 'email'));
      if (email && !isEmail(email)) { issue('warning', S, n, 'Email Address', `"${email}" is not a valid email; left blank.`); email = null; }

      const access = [];
      for (const part of String(cell(c, 'account access') ?? '').split(/[\n,;]+/)) {
        const a = clean(part);
        if (!a || a.toLowerCase() === 'none') continue;
        const nm = lookup(accessSys, a, 'access', S, n, 'Account Access', 'Access system');
        if (nm) access.push(nm);
      }
      const company = lookup(companies, cell(c, 'company'), 'companies', S, n, 'Company', 'Company');
      const designation = lookup(designations, cell(c, 'designation'), 'designations', S, n, 'Designation', 'Designation');
      if (!clean(cell(c, 'company'))) issue('warning', S, n, 'Company', 'No company.');
      if (!clean(cell(c, 'designation'))) issue('warning', S, n, 'Designation', 'No designation.');

      if (bad) { plan.tech.err++; continue; }
      const exists = L.techKeys.has(key);
      if (exists) { plan.tech.dup++; issue('info', S, n, 'Name', `"${first} ${sur}" already exists; not changed.`); }
      else {
        okKeys.add(key);
        plan.tech.items.push({ row: n, key, first_name: first, middle_name: clean(cell(c, 'middle name')), surname: sur, birthdate, date_hired: hired,
          company, designation, mobile, email, employment_status: status, date_separated: separated, separation_reason: clean(cell(c, 'separation reason')),
          lms_user: clean(cell(c, 'lms user')), lms_login: clean(cell(c, 'log in')), access: [...new Set(access)] });
        plan.completeness.technicians++;
        if (!birthdate) plan.completeness.birthdate++;
        if (!hired) plan.completeness.hired++;
        if (!email) plan.completeness.email++;
        if (!mobile) plan.completeness.mobile++;
      }

      // training dates for this technician (new or existing)
      for (const tc of trainCols) {
        const raw = c[tc.i];
        if (raw == null || raw === '') continue;
        plan.training.total++;
        const d = toISODate(raw);
        if (d.bad || !d.iso) { plan.training.err++; issue('error', S, n, tc.type, `Unrecognised date "${raw}".`); continue; }
        if (d.iso > today) { plan.training.err++; issue('error', S, n, tc.type, `Completion date ${d.iso} is in the future.`); continue; }
        if (hired && d.iso < hired) issue('warning', S, n, tc.type, `Completed ${d.iso}, before the hire date ${hired}.`);
        if (L.existTraining.has(`${key}|${tc.type.toLowerCase()}|${d.iso}`)) { plan.training.dup++; continue; }
        plan.training.items.push({ row: n, key, type: tc.type, date: d.iso });
      }
    }
    const extra = [];   // data under "(Extra n)" placeholder columns would be silently lost
    for (let i = from; i < to; i++) if (h[i]?.startsWith('(') && tr.rows.some((r) => r.c[i] != null && r.c[i] !== '')) extra.push(tr.rawHdr?.[i] ?? h[i]);
    if (extra.length) issue('warning', S, null, extra.join(', '), 'Placeholder training columns contain dates; they are not imported. Add them as training types first.');
  }

  // ---------------- Violations ----------------
  const vsig = new Set();
  const vr = sheets.violations;
  if (!vr) issue('warning', 'Violation Records', null, null, 'Sheet "Violation Records" was not found.');
  else if (vr.missingHeader) issue('error', 'Violation Records', null, null, 'Header row with "Date of Violation" was not found.');
  else {
    const S = 'Violation Records', h = vr.hdr;
    const ci = Object.fromEntries([['date', 'date of violation'], ['tech', 'technician'], ['cat', 'violation category'], ['desc', 'description'], ['sev', 'severity'],
      ['by', 'reported by'], ['act', 'action taken'], ['ret', 'retraining required'], ['status', 'status'], ['rem', 'remarks'], ['ev', 'evidence link'],
      ['rec', 'recommendation'], ['ibas', 'ibas'], ['jo', 'jo number']].map(([k, p]) => [k, colOf(h, p)]));
    const g = (c, k) => (ci[k] >= 0 ? c[ci[k]] : null);
    for (const { n, c } of vr.rows) {
      if (!clean(g(c, 'tech')) && !clean(g(c, 'desc')) && g(c, 'date') == null) continue;
      plan.violations.total++;
      let bad = false;
      const err = (f, m) => { bad = true; issue('error', S, n, f, m); };
      const d = toISODate(g(c, 'date'));
      if (!d.iso) err('Date of Violation', d.bad ? 'Unrecognised date.' : 'Date is required.');
      else if (d.iso > today) err('Date of Violation', `Date ${d.iso} is in the future.`);
      const techText = clean(g(c, 'tech')), key = lc(techText);
      if (!techText) err('Technician', 'Technician is required.');
      else if (!okKeys.has(key)) err('Technician', `Technician "${techText}" was not found (use "First Surname" exactly as in Training Records).`);
      const desc = clean(g(c, 'desc'));
      if (!desc) err('Description / Finding', 'Description is required.');
      const sev = canon(SEVERITY, g(c, 'sev'));
      if (!sev) err('Severity', `Unknown severity "${clean(g(c, 'sev')) ?? ''}".`);
      const stRaw = clean(g(c, 'status'));
      const status = stRaw ? canon(VSTATUS, stRaw) : 'Open';
      if (!status) err('Status', `Unknown status "${stRaw}".`);
      const retRaw = lc(g(c, 'ret'));
      let retraining = true;
      if (retRaw === 'no') retraining = false;
      else if (retRaw !== 'yes') issue('warning', S, n, 'Retraining Required', 'Blank or unclear; treated as Yes (counts as an offense).');

      const refs = [];
      const catText = clean(g(c, 'cat'));
      if (!catText) err('Violation Category', 'At least one category is required.');
      else for (const part of catText.split(';')) {
        const p = hyphen(part);
        if (!p) continue;
        const full = catByFull.get(p.toLowerCase());
        const code = p.split(/\s+-\s+/)[0].toLowerCase();
        const byCode = catByCode.get(code) || [];
        if (full) refs.push({ id: full.id, key: `${full.code}|${full.name}` });
        else if (byCode.length === 1) refs.push({ id: byCode[0].id, key: `${byCode[0].code}|${byCode[0].name}` });
        else if (byCode.length > 1) err('Violation Category', `Code "${code.toUpperCase()}" matches ${byCode.length} categories; use the full "code - name" text.`);
        else if (options.createLookups) {
          const [cd, ...rest] = p.split(/\s+-\s+/);
          const nm = rest.join(' - ') || cd;
          need.categories.set(`${cd.toLowerCase()}|${nm.toLowerCase()}`, { code: cd, name: nm });
          refs.push({ key: `${cd}|${nm}`, fresh: true });
          issue('info', S, n, 'Violation Category', `Category "${p}" will be created.`);
        } else err('Violation Category', `Category "${p}" is not in the system list.`);
      }
      const action = lookupAction(actions, g(c, 'act'), S, n, issue);
      let evidence = null;
      const evRaw = clean(g(c, 'ev'));
      if (evRaw) { try { const u = new URL(evRaw); if (u.protocol === 'https:') evidence = u.href; else issue('warning', S, n, 'Evidence Link', 'Evidence link is not https; not imported.'); } catch { issue('warning', S, n, 'Evidence Link', 'Evidence link is not a valid URL; not imported.'); } }
      const ibasRaw = g(c, 'ibas');
      const ibas = typeof ibasRaw === 'number' ? String(ibasRaw) : clean(ibasRaw);
      if (bad) { plan.violations.err++; continue; }

      const sig = `${key}|${d.iso}|${(desc || '').toLowerCase()}`;
      if (L.existViolations.has(sig) || vsig.has(sig)) { plan.violations.dup++; issue('info', S, n, null, 'Duplicate of an existing violation (same technician, date and description); skipped.'); continue; }
      vsig.add(sig);
      plan.violations.items.push({ row: n, key, date: d.iso, desc, severity: sev, status, retraining_required: retraining, refs, sig,
        reported_by: clean(g(c, 'by')), action, remarks: clean(g(c, 'rem')), recommendation: clean(g(c, 'rec')), ibas_no: ibas, jo_number: clean(g(c, 'jo')), evidence });
    }
  }

  // ---------------- Retraining ----------------
  const rt = sheets.retraining;
  if (rt && !rt.missingHeader) {
    const S = 'Retraining Records', h = rt.hdr;
    const ci = Object.fromEntries([['vdate', 'date of violation'], ['tech', 'technician'], ['find', 'qa violation'], ['type', 'training retaken'], ['date', 'retraining date'],
      ['by', 'conducted by'], ['res', 'result'], ['rem', 'remarks']].map(([k, p]) => [k, colOf(h, p)]));
    const g = (c, k) => (ci[k] >= 0 ? c[ci[k]] : null);
    const stagedViol = new Set(plan.violations.items.map((v) => `${v.key}|${v.date}`));
    for (const { n, c } of rt.rows) {
      if (!clean(g(c, 'tech')) && !clean(g(c, 'type'))) continue;
      plan.retrainings.total++;
      let bad = false;
      const err = (f, m) => { bad = true; issue('error', S, n, f, m); };
      const techText = clean(g(c, 'tech')), key = lc(techText);
      if (!techText || !okKeys.has(key)) err('Technician', `Technician "${techText ?? ''}" was not found.`);
      const type = types.get(lc(g(c, 'type')) ?? '');
      if (!type) err('Training Retaken', `Unknown training "${clean(g(c, 'type')) ?? ''}".`);
      const result = clean(g(c, 'res')) ? canon(RESULT, g(c, 'res')) : 'Pending';
      if (!result) err('Result', `Unknown result "${clean(g(c, 'res'))}".`);
      const rd = toISODate(g(c, 'date')), vd = toISODate(g(c, 'vdate'));
      if (rd.bad) err('Retraining Date', 'Unrecognised date.');
      if (result && result !== 'Pending' && !rd.iso) err('Retraining Date', 'A date is required for Passed or Failed.');
      if (result && result !== 'Pending' && rd.iso > today) err('Retraining Date', 'A completed retraining cannot be in the future.');
      if (bad) { plan.retrainings.err++; continue; }
      const linked = vd.iso && (stagedViol.has(`${key}|${vd.iso}`) || L.existViolDates.has(`${key}|${vd.iso}`));
      if (!linked) issue('warning', S, n, 'Date of Violation', 'No matching violation found; imported as a manual retraining.');
      if (L.existRetrainings.has(`${key}|${type.name.toLowerCase()}|${rd.iso ?? ''}|${linked ? vd.iso : ''}`)) { plan.retrainings.dup++; continue; }
      plan.retrainings.items.push({ row: n, key, type: type.name, date: rd.iso, trainer: clean(g(c, 'by')), result, remarks: clean(g(c, 'rem')),
        violDate: linked ? vd.iso : null, manual: linked ? null : `Imported from workbook; no matching violation (${clean(g(c, 'find')) ?? 'n/a'})` });
    }
  }
  return plan;
}

function lookupAction(map, raw, sheet, row, issue) {
  const v = clean(raw);
  if (!v) return null;
  const hit = map.get(v.toLowerCase());
  if (hit) return hit.name;
  issue('warning', sheet, row, 'Action Taken', `Action "${v}" is not in the system list; left blank.`);
  return null;
}
