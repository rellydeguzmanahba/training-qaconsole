import { fetchAll } from '../utils/db.js';
import { friendlyError } from '../utils/errors.js';

const lc = (s) => String(s ?? '').toLowerCase();
const chunks = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, (i + 1) * n));
const why = (e) => `${friendlyError(e)}${e?.message && e.code ? ` (${e.message})` : ''}`;

// Same source row -> same UUID, so re-running an import after a partial failure cannot create duplicates.
async function detUUID(text) {
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))).slice(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Try a whole chunk; if it fails, retry row by row so one bad row cannot sink the others.
async function chunked(items, size, exec, onFail) {
  let ok = 0; const out = [];
  for (const part of chunks(items, size)) {
    try { out.push(...((await exec(part)) || [])); ok += part.length; }
    catch (e) {
      if (part.length === 1) { onFail(part[0], e); continue; }
      for (const it of part) {
        try { out.push(...((await exec([it])) || [])); ok++; } catch (e2) { onFail(it, e2); }
      }
    }
  }
  return { ok, out };
}

// include: { tech, training, violations, retrainings } booleans. Never updates or deletes existing rows.
export async function commitPlan(ctx, plan, { include, fileName }, onProgress = () => {}) {
  const { sb } = ctx, uid = ctx.profile.user_id;
  const R = { tech: 0, training: 0, violations: 0, retrainings: 0, evidence: 0, failures: [] };
  const fail = (sheet, row, field, e) => R.failures.push({ severity: 'error', sheet, row, field, message: typeof e === 'string' ? e : why(e) });

  // 0) audit trail of this import
  const counts = Object.fromEntries(['tech', 'training', 'violations', 'retrainings'].map((k) => [k, { file: plan[k].total, importable: include[k] ? plan[k].items.length : 0, duplicates: plan[k].dup, excluded: plan[k].err }]));
  const { data: batch, error: be } = await sb.from('import_batches').insert({ file_name: fileName.slice(0, 200), status: 'previewed', summary: counts, created_by: uid }).select('id').single();
  if (be) throw be;
  const saved = plan.issues.filter((i) => i.severity !== 'info').map((i) => ({ batch_id: batch.id, sheet: i.sheet, row_no: i.row, field: i.field, severity: i.severity, message: i.message.slice(0, 500) }));
  for (const part of chunks(saved, 500)) { const { error } = await sb.from('import_errors').insert(part); if (error) throw error; }

  // 1) missing lookup values (only when the user opted in; the plan lists exactly what is needed)
  onProgress({ phase: 'Preparing lists', done: 0, total: 1 });
  const addNames = async (table, wanted) => {
    if (!wanted.length) return;
    const { data, error } = await sb.from(table).select('name');
    if (error) throw error;
    const have = new Set(data.map((r) => lc(r.name).trim()));
    const rows = wanted.filter((n) => !have.has(lc(n))).map((name) => ({ name }));
    if (rows.length) { const { error: e } = await sb.from(table).insert(rows); if (e) throw e; }
  };
  await addNames('companies', [...plan.need.companies.values()]);
  await addNames('designations', [...plan.need.designations.values()]);
  await addNames('access_systems', [...plan.need.access.values()]);
  if (plan.need.categories.size) {
    const { error } = await sb.from('violation_categories').upsert([...plan.need.categories.values()], { onConflict: 'code,name', ignoreDuplicates: true });
    if (error) throw error;
  }
  const names = async (t) => { const { data, error } = await sb.from(t).select('id,name'); if (error) throw error; return new Map(data.map((r) => [lc(r.name), r.id])); };
  const [coId, deId, acId, tyId, anId] = await Promise.all(['companies', 'designations', 'access_systems', 'training_types', 'action_types'].map(names));
  const { data: catRows, error: ce } = await sb.from('violation_categories').select('id,code,name');
  if (ce) throw ce;
  const catId = new Map(catRows.map((c) => [lc(`${c.code}|${c.name}`), c.id]));

  // 2) technicians (new only) + account access
  if (include.tech && plan.tech.items.length) {
    const items = plan.tech.items, byKey = new Map(items.map((t) => [t.key, t]));
    const payload = (t) => ({ first_name: t.first_name, middle_name: t.middle_name, surname: t.surname, birthdate: t.birthdate, date_hired: t.date_hired,
      company_id: coId.get(lc(t.company)) ?? null, designation_id: deId.get(lc(t.designation)) ?? null, mobile: t.mobile, email: t.email,
      employment_status: t.employment_status, date_separated: t.date_separated, separation_reason: t.separation_reason, lms_user: t.lms_user, lms_login: t.lms_login, created_by: uid });
    let done = 0;
    const { ok, out } = await chunked(items, 50, async (part) => {
      const { data, error } = await sb.from('technicians').insert(part.map(payload)).select('id,name_key');
      if (error) throw error;
      done += part.length; onProgress({ phase: 'Technicians', done, total: items.length });
      return data;
    }, (t, e) => fail('Training Records', t.row, 'Technician', e));
    R.tech = ok;
    const links = [];
    for (const r of out) for (const a of byKey.get(r.name_key)?.access ?? []) if (acId.has(lc(a))) links.push({ technician_id: r.id, access_id: acId.get(lc(a)) });
    for (const part of chunks(links, 200)) {
      const { error } = await sb.from('technician_access').upsert(part, { onConflict: 'technician_id,access_id', ignoreDuplicates: true });
      if (error) fail('Training Records', null, 'Account Access', error);
    }
  }
  const techs = await fetchAll(() => sb.from('technicians').select('id,name_key').order('id'));
  const techId = new Map(techs.map((t) => [t.name_key, t.id]));
  const keyOfId = new Map(techs.map((t) => [t.id, t.name_key]));

  // 3) training records (duplicates by technician + training + date are skipped by the database)
  if (include.training && plan.training.items.length) {
    const rows = []; 
    for (const t of plan.training.items) {
      const technician_id = techId.get(t.key), training_type_id = tyId.get(lc(t.type));
      if (!technician_id) { fail('Training Records', t.row, t.type, 'Technician was not imported, so this training date was skipped.'); continue; }
      rows.push({ row: t.row, type: t.type, rec: { technician_id, training_type_id, completed_on: t.date, created_by: uid } });
    }
    let done = 0;
    const { ok } = await chunked(rows, 200, async (part) => {
      const { data, error } = await sb.from('training_records').upsert(part.map((p) => p.rec), { onConflict: 'technician_id,training_type_id,completed_on', ignoreDuplicates: true }).select('id');
      if (error) throw error;
      done += part.length; onProgress({ phase: 'Training records', done, total: rows.length });
      return data;
    }, (p, e) => fail('Training Records', p.row, p.type, e));
    R.training = ok;
  }

  // 4) violations: one atomic RPC per row, idempotent through a deterministic request id
  const evidence = [];
  if (include.violations && plan.violations.items.length) {
    const items = plan.violations.items;
    for (let i = 0; i < items.length; i++) {
      const v = items[i];
      onProgress({ phase: 'Violations', done: i, total: items.length });
      const technician_id = techId.get(v.key);
      if (!technician_id) { fail('Violation Records', v.row, 'Technician', 'Technician was not found in the database.'); continue; }
      const cats = v.refs.map((r) => r.id ?? catId.get(lc(r.key))).filter(Boolean);
      if (cats.length !== v.refs.length) { fail('Violation Records', v.row, 'Violation Category', 'A category could not be resolved.'); continue; }
      const p = { technician_id, violation_date: v.date, description: v.desc, severity: v.severity, status: v.status, retraining_required: v.retraining_required,
        reported_by: v.reported_by, action_taken_id: v.action ? anId.get(lc(v.action)) ?? null : null, remarks: v.remarks, recommendation: v.recommendation,
        ibas_no: v.ibas_no, jo_number: v.jo_number, client_request_id: await detUUID(`v1|${v.sig}|${[...cats].sort().join(',')}`) };
      const { data, error } = await sb.rpc('create_violation', { p, p_categories: cats });
      if (error) { fail('Violation Records', v.row, null, error); continue; }
      R.violations++;
      if (v.evidence) evidence.push({ violation_id: data, url: v.evidence });
    }
    onProgress({ phase: 'Violations', done: items.length, total: items.length });
    if (evidence.length) {
      const have = await fetchAll(() => sb.from('violation_evidence').select('id,violation_id,external_url').in('violation_id', evidence.map((e) => e.violation_id)).order('id'));
      const seen = new Set(have.map((e) => `${e.violation_id}|${e.external_url}`));
      const rows = evidence.filter((e) => !seen.has(`${e.violation_id}|${e.url}`))
        .map((e) => ({ violation_id: e.violation_id, external_url: e.url, file_name: `Imported link (${new URL(e.url).hostname})`, uploaded_by: uid }));
      for (const part of chunks(rows, 200)) {
        const { error } = await sb.from('violation_evidence').insert(part);
        if (error) fail('Violation Records', null, 'Evidence Link', error); else R.evidence += part.length;
      }
    }
  }

  // 5) retraining history (direct insert: history is preserved as recorded, violation statuses are not auto-changed)
  if (include.retrainings && plan.retrainings.items.length) {
    const viol = await fetchAll(() => sb.from('violations').select('id,technician_id,violation_date').order('violation_date').order('id'));
    const vId = new Map();
    for (const v of viol) { const k = `${keyOfId.get(v.technician_id)}|${v.violation_date}`; if (!vId.has(k)) vId.set(k, v.id); }
    const rows = [];
    for (const r of plan.retrainings.items) {
      const technician_id = techId.get(r.key);
      if (!technician_id) { fail('Retraining Records', r.row, 'Technician', 'Technician was not found in the database.'); continue; }
      const violation_id = r.violDate ? vId.get(`${r.key}|${r.violDate}`) ?? null : null;
      rows.push({ row: r.row, rec: { technician_id, violation_id, training_type_id: tyId.get(lc(r.type)), retraining_date: r.date, trainer: r.trainer, result: r.result,
        remarks: r.remarks, manual_reason: violation_id ? null : (r.manual ?? 'Imported from workbook'), created_by: uid,
        client_request_id: await detUUID(`r1|${r.key}|${r.violDate ?? ''}|${r.type}|${r.date ?? ''}|${r.result}`) } });
    }
    let done = 0;
    const { ok } = await chunked(rows, 100, async (part) => {
      const { data, error } = await sb.from('retrainings').insert(part.map((p) => p.rec)).select('id');
      if (error) throw error;
      done += part.length; onProgress({ phase: 'Retraining', done, total: rows.length });
      return data;
    }, (p, e) => (e?.code === '23505' ? null : fail('Retraining Records', p.row, null, e)));
    R.retrainings = ok;
  }

  // 6) recompute offense proposals and close the audit record
  onProgress({ phase: 'Recalculating offenses', done: 0, total: 1 });
  const { error: re } = await sb.rpc('recalculate_offenses', { p_technician: null });
  if (re) fail('System', null, null, `Offense recalculation failed: ${why(re)}`);
  const imported = R.tech + R.training + R.violations + R.retrainings;
  await sb.from('import_batches').update({ status: imported || !R.failures.length ? 'committed' : 'failed', committed_at: new Date().toISOString(),
    summary: { ...counts, result: { technicians: R.tech, training: R.training, violations: R.violations, retrainings: R.retrainings, evidence: R.evidence, failures: R.failures.length } } }).eq('id', batch.id);
  return R;
}
