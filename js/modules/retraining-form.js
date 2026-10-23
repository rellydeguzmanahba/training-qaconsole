import { formModal } from '../ui/form.js';
import { el } from '../utils/dom.js';
import { todayISO } from '../utils/dates.js';
import { newRequestId } from '../utils/submit.js';
import { fmtDate } from '../utils/dates.js';

const RESULTS = ['Pending', 'Passed', 'Failed'];

// violation = { id, technician_id, technician_name, violation_date }  -> assign retraining for that violation
// record    = existing retraining row (with version, technician_name, type_name) -> edit / record outcome
// neither   -> pick a violation, or log a manual retraining (no offense effect)
// Resolves the retraining id or null.
export async function openRetrainingForm(ctx, { violation = null, record = null } = {}) {
  const today = todayISO();
  const types = await ctx.sb.from('training_types').select('id,name').eq('active', true).order('sort_order').order('id');
  if (types.error) throw types.error;

  const common = [
    { name: 'training_type_id', label: 'Retraining (training type)', type: 'select', required: true, options: types.data.map((t) => ({ value: t.id, label: t.name })) },
    { name: 'result', label: 'Outcome', type: 'select', required: true, options: RESULTS.map((r) => ({ value: r, label: r })) },
    { name: 'retraining_date', label: 'Retraining date', type: 'date', required: (v) => v.result !== 'Pending',
      hint: 'Required once the outcome is Passed or Failed. For Pending, enter the scheduled date if known.' },
    { name: 'trainer', label: 'Trainer', type: 'text', maxlength: 120 },
    { name: 'remarks', label: 'Remarks', type: 'textarea', maxlength: 500 },
  ];
  const requestId = newRequestId();
  const validate = (v) => (v.result !== 'Pending' && v.retraining_date > today ? { retraining_date: 'A completed retraining cannot be dated in the future.' } : {});
  let intro = null, fields = common, values = { result: 'Pending' };

  if (record) {
    values = record;
    intro = el('p', { class: 'muted small' }, `${record.technician_name}${record.violation_date ? ` — violation of ${fmtDate(record.violation_date)}` : ' — manual retraining'}`);
  } else if (violation) {
    intro = el('p', { class: 'muted small' }, `${violation.technician_name} — violation of ${fmtDate(violation.violation_date)}`);
  } else {
    const [vs, ts] = await Promise.all([
      ctx.sb.from('violations').select('id,violation_date,technician:technicians(first_name,surname),violation_category_links(violation_categories(code))')
        .eq('retraining_required', true).neq('status', 'Closed').order('violation_date', { ascending: false }),
      ctx.sb.from('technicians').select('id,first_name,surname').not('employment_status', 'in', '(Resigned,Terminated)').order('surname').order('first_name'),
    ]);
    for (const r of [vs, ts]) if (r.error) throw r.error;
    fields = [
      { name: 'violation_id', label: 'Linked violation (leave empty for a manual retraining)', type: 'select',
        options: vs.data.map((x) => ({ value: x.id, label: `${fmtDate(x.violation_date)} – ${x.technician?.first_name} ${x.technician?.surname} – ${x.violation_category_links.map((l) => l.violation_categories?.code).join(', ')}` })) },
      { name: 'technician_id', label: 'Technician', type: 'select', visible: (v) => !v.violation_id, required: (v) => !v.violation_id,
        options: ts.data.map((t) => ({ value: t.id, label: `${t.surname}, ${t.first_name}` })) },
      { name: 'manual_reason', label: 'Reason for manual retraining', type: 'text', maxlength: 300, visible: (v) => !v.violation_id, required: (v) => !v.violation_id },
      ...common];
  }

  const res = await formModal({
    title: record ? 'Update retraining' : 'Assign retraining', wide: true, submitText: record ? 'Save changes' : 'Save',
    intro, fields, values, validate,
    onSubmit: async (v) => {
      const p = { ...v, client_request_id: requestId };
      if (violation) p.violation_id = violation.id;
      const { data, error } = await ctx.sb.rpc('save_retraining', { p_id: record?.id ?? null, p_version: record?.version ?? null, p });
      if (error) throw error;
      return data;
    },
  });
  return res ? res.result : null;
}
