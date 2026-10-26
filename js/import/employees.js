// Pure plan builder for the "Employee Details" sheet. Matches by name, never clears a value,
// and classifies every difference as a safe FILL (database blank) or an OVERWRITE (needs explicit selection).
import { clean, toISODate } from './parse.js';
import { isEmail, isMobile } from '../utils/validate.js';

export const STATUS = ['Applicant', 'Probationary', 'Regular', 'Resigned', 'Terminated'];
const SEP = ['Resigned', 'Terminated'];
const SUFFIX = /^(jr\.?|sr\.?|ii|iii|iv|v)$/i;
export const SYSTEMS = [
  { header: 'salesforce', label: 'SalesForce', candidates: ['Salesforce'] },
  { header: 'wfm mobile', label: 'WFM Mobile', candidates: ['WFM Mobile', 'WFM'] },
  { header: 'jo mobile', label: 'Jo Mobile', candidates: ['Jo Mobile'] },
  { header: 'account lookup', label: 'Account Lookup', candidates: ['Account Lookup'] },
];
const lc = (v) => clean(v)?.toLowerCase() ?? null;
const blank = (v) => v == null || String(v).trim() === '';
const yesNo = (v) => { const s = lc(v); if (!s) return null; if (['yes', 'y', 'true', '1'].includes(s)) return true; if (['no', 'n', 'false', '0'].includes(s)) return false; return undefined; };

// "Antonio Tereso Jr" -> first "Antonio", surname "Tereso Jr"; "Christian Lee Cabarrubias" -> "Christian Lee" / "Cabarrubias"
export function splitName(full) {
  const p = clean(full).split(' ');
  if (p.length < 2) return { first: p[0], surname: '' };
  const n = p.length > 2 && SUFFIX.test(p[p.length - 1]) ? 2 : 1;
  return { first: p.slice(0, p.length - n).join(' '), surname: p.slice(p.length - n).join(' ') };
}

export function buildEmployeePlan({ sheet, db, today, options = {} }) {
  const issues = [], items = [];
  const issue = (severity, row, field, message) => issues.push({ severity, sheet: 'Employee Details', row, field, message });
  const need = { companies: new Map(), designations: new Map(), access: new Map() };
  const plan = { items, issues, need, notInFile: [], stats: { rows: 0, newRows: 0, updateRows: 0, sameRows: 0, review: 0, errors: 0 } };
  if (!sheet || sheet.missingHeader) { issue('error', null, null, 'Header row with "Name" was not found. Use the Employee Details sheet.'); return plan; }

  const col = (name) => sheet.hdr.indexOf(name);
  const ci = Object.fromEntries(['name', 'designation', 'company', 'status', 'date hired', 'mobile', 'email', 'lms user'].map((k) => [k, col(k)]));
  if (ci.name < 0) { issue('error', null, 'Name', 'Column "Name" is required.'); return plan; }
  for (const s of SYSTEMS) ci[s.header] = col(s.header);

  const byLc = (list) => new Map(list.map((x) => [x.name.toLowerCase(), x]));
  const companies = byLc(db.companies), designations = byLc(db.designations), access = byLc(db.access);
  const byKey = new Map(db.techs.map((t) => [t.name_key, t]));
  const mobileOwner = new Map(db.techs.filter((t) => t.mobile).map((t) => [t.mobile, t.name_key]));
  const emailOwner = new Map(db.techs.filter((t) => t.email).map((t) => [t.email.toLowerCase(), t.name_key]));
  const seen = new Set();
  let lmsNoted = false;

  const resolveLookup = (map, kind, raw, row, label) => {
    const v = clean(raw);
    if (!v) return null;
    const hit = map.get(v.toLowerCase());
    if (hit) return hit.name;
    if (options.createLookups) { need[kind].set(v.toLowerCase(), v); return v; }
    issue('warning', row, label, `${label} "${v}" is not in the system list; skipped (tick "create missing" to add it).`);
    return null;
  };

  for (const { n, c } of sheet.rows) {
    const rawName = clean(c[ci.name]);
    if (!rawName) continue;
    plan.stats.rows++;
    const key = rawName.toLowerCase();
    if (seen.has(key)) { plan.stats.errors++; issue('error', n, 'Name', `"${rawName}" appears more than once in the file; this row is skipped.`); continue; }
    seen.add(key);

    const cur = byKey.get(key) ?? null;
    const item = { row: n, name: rawName, key, kind: cur ? 'match' : 'new', techId: cur?.id ?? null, version: cur?.version ?? null, changes: [], data: {}, hold: false, notes: [] };
    let bad = false;
    const err = (f, m) => { bad = true; issue('error', n, f, m); };
    const get = (k) => (ci[k] >= 0 ? c[ci[k]] : null);

    // ----- incoming values
    const designation = resolveLookup(designations, 'designations', get('designation'), n, 'Designation');
    const company = resolveLookup(companies, 'companies', get('company'), n, 'Company');
    let status = blank(get('status')) ? null : STATUS.find((s) => s.toLowerCase() === lc(get('status')));
    if (!blank(get('status')) && !status) err('Status', `Unknown status "${clean(get('status'))}".`);
    if (status && SEP.includes(status)) { issue('warning', n, 'Status', `"${status}" is not applied by import. Use Deactivate on the employee profile.`); status = null; }
    if (cur && SEP.includes(cur.employment_status) && status) { issue('warning', n, 'Status', 'This employee is deactivated; reactivate from the profile. Status ignored.'); status = null; }
    const hd = toISODate(get('date hired'));
    let hired = hd.iso;
    if (hd.bad) issue('warning', n, 'Date Hired', 'Unrecognised date; skipped.');
    if (hired && hired > today) { issue('warning', n, 'Date Hired', `Date ${hired} is in the future; skipped.`); hired = null; }

    let mobile = null;
    if (!blank(get('mobile'))) {
      mobile = clean(typeof get('mobile') === 'number' ? String(get('mobile')) : get('mobile'));
      if (typeof get('mobile') === 'number') issue('warning', n, 'Mobile', 'Stored as a number in Excel; a leading zero may be missing.');
      if (!isMobile(mobile)) { issue('warning', n, 'Mobile', `"${mobile}" is not a valid mobile number; skipped.`); mobile = null; }
      else if (mobileOwner.has(mobile) && mobileOwner.get(mobile) !== key) {
        issue('warning', n, 'Mobile', `Already used by another employee (${mobileOwner.get(mobile)}); skipped.`); item.hold = !cur; mobile = null;
      }
    }
    let email = null;
    if (!blank(get('email'))) {
      email = lc(get('email'));
      if (!isEmail(email)) {
        const fix = email.replace(/,/g, '.'), tail = email.split(' ').pop();
        const hint = isEmail(fix) ? ` Did you mean ${fix}?` : isEmail(tail) ? ` Did you mean ${tail}?` : '';
        issue('warning', n, 'Email', `"${email}" is not a valid email; skipped.${hint}`); email = null;
      } else if (emailOwner.has(email) && emailOwner.get(email) !== key) {
        issue('warning', n, 'Email', `Already used by another employee (${emailOwner.get(email)}); skipped.`); item.hold = !cur; email = null;
      }
    }
    let lms = yesNo(get('lms user'));
    if (lms === undefined) { issue('warning', n, 'LMS User', `"${clean(get('lms user'))}" is not Yes/No; skipped.`); lms = null; }
    if (lms !== null && !db.lmsAvailable) { if (!lmsNoted) { issue('info', null, 'LMS User', 'LMS flag is not imported until migration 009 is applied.'); lmsNoted = true; } lms = null; }

    const sys = [];
    for (const s of SYSTEMS) {
      const val = yesNo(ci[s.header] >= 0 ? c[ci[s.header]] : null);
      if (val === undefined) { issue('warning', n, s.label, `"${clean(c[ci[s.header]])}" is not Yes/No; skipped.`); continue; }
      if (val === null) continue;
      let rec = s.candidates.map((x) => access.get(x.toLowerCase())).find(Boolean) ?? null;
      let name = rec?.name ?? null;
      if (!rec && val) {
        if (options.createLookups) { name = s.candidates[0]; need.access.set(name.toLowerCase(), name); }
        else { issue('warning', n, s.label, `Access system "${s.candidates[0]}" does not exist; skipped (tick "create missing").`); continue; }
      }
      if (name || !val) sys.push({ label: s.label, name, val, id: rec?.id ?? null });
    }

    if (item.kind === 'new') {
      const sp = splitName(rawName);
      if (!sp.surname) err('Name', `"${rawName}": first name and surname are both needed to add a new employee.`);
      if (!status) err('Status', 'Status (Probationary / Regular) is required for a new employee.');
      if (bad) { plan.stats.errors++; continue; }
      item.split = sp;
      item.data = { designation, company, employment_status: status, date_hired: hired, mobile, email, has_lms_account: lms ?? false, access: sys.filter((s) => s.val).map((s) => s.name) };
      if (!designation) issue('warning', n, 'Designation', 'No designation.');
      if (!company) issue('warning', n, 'Company', 'No company.');
      if (item.hold) { plan.stats.review++; issue('warning', n, 'Name', 'Possible duplicate (shared mobile/email with an existing employee); held for review.'); }
      plan.stats.newRows++; items.push(item); continue;
    }

    // ----- matched employee: compare field by field
    const add = (field, label, from, to, type, extra = {}) => item.changes.push({ id: `${n}|${field}`, field, label, from, to, type, on: type === 'fill', ...extra });
    const text = (field, label, curV, inc) => {
      if (inc == null) return;
      if (blank(curV)) add(field, label, null, inc, 'fill');
      else if (String(curV).toLowerCase() !== String(inc).toLowerCase()) add(field, label, curV, inc, 'change');
    };
    text('designation', 'Designation', cur.designation, designation);
    text('company', 'Company', cur.company, company);
    text('employment_status', 'Status', cur.employment_status, status);
    text('date_hired', 'Date hired', cur.date_hired, hired);
    text('mobile', 'Mobile', cur.mobile, mobile);
    text('email', 'Email', cur.email, email);
    if (lms !== null) { const had = !!cur.has_lms_account; if (lms && !had) add('has_lms_account', 'LMS User', 'No', 'Yes', 'fill'); else if (!lms && had) add('has_lms_account', 'LMS User', 'Yes', 'No', 'change'); }
    for (const s of sys) {
      const has = s.id != null && cur.accessIds.has(s.id);
      if (s.val && !has) add(`access:${s.name}`, s.label, 'No', 'Yes', 'fill', { accessName: s.name, accessAdd: true });
      else if (!s.val && has) add(`access:${s.name}`, s.label, 'Yes', 'No', 'change', { accessName: s.name, accessAdd: false });
    }
    if (item.changes.length) plan.stats.updateRows++; else plan.stats.sameRows++;
    items.push(item);
  }
  plan.notInFile = db.techs.filter((t) => !seen.has(t.name_key)).map((t) => t.name_key);
  return plan;
}
