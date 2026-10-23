import { formModal } from '../ui/form.js';
import { showModal } from '../ui/dialog.js';
import { el } from '../utils/dom.js';
import { todayISO } from '../utils/dates.js';
import { newRequestId } from '../utils/submit.js';
import { UserError } from '../utils/errors.js';

export const SEVERITIES = ['Minor', 'Major', 'Critical'];
export const VSTATUSES = ['Open', 'For Retraining', 'Closed'];

// record = existing violation row incl. category_ids (array) and version; resolves with the violation id or null.
export async function openViolationForm(ctx, { record = null, technicianId = null } = {}) {
  const today = todayISO();
  const [techs, cats, acts] = await Promise.all([
    ctx.sb.from('technicians').select('id,first_name,surname,employment_status,company:companies(name)').order('surname').order('first_name'),
    ctx.sb.from('violation_categories').select('id,code,name,active').order('code'),
    ctx.sb.from('action_types').select('id,name,active').order('name'),
  ]);
  for (const r of [techs, cats, acts]) if (r.error) throw r.error;
  const curCats = new Set((record?.category_ids || []).map(String));
  const requestId = newRequestId();                              // same id on every retry of this form => no duplicates

  const res = await formModal({
    title: record ? 'Edit violation' : 'Record QA violation', wide: true, submitText: record ? 'Save changes' : 'Save violation',
    values: record ? { ...record, categories: [...curCats] }
      : { technician_id: technicianId, severity: 'Minor', status: 'Open', retraining_required: true, reported_by: ctx.profile.full_name, categories: [] },
    fields: [
      { name: 'technician_id', label: 'Technician', type: 'select', required: true,
        options: techs.data.filter((t) => !['Resigned', 'Terminated'].includes(t.employment_status) || t.id === record?.technician_id)
          .map((t) => ({ value: t.id, label: `${t.surname}, ${t.first_name}${t.company?.name ? ` (${t.company.name})` : ''}` })) },
      { name: 'violation_date', label: 'Date reported', type: 'date', required: true, max: today },
      { name: 'categories', label: 'Violation categories', type: 'checks', required: true, scroll: true,
        options: cats.data.filter((c) => c.active || curCats.has(String(c.id))).map((c) => ({ value: c.id, label: `${c.code} – ${c.name}` })) },
      { name: 'severity', label: 'Severity', type: 'select', required: true, options: SEVERITIES.map((s) => ({ value: s, label: s })) },
      { name: 'status', label: 'Status', type: 'select', required: true, options: VSTATUSES.map((s) => ({ value: s, label: s })) },
      { name: 'description', label: 'Description of finding', type: 'textarea', required: true, maxlength: 2000 },
      { name: 'reported_by', label: 'Reported by', type: 'text', maxlength: 120 },
      { name: 'action_taken_id', label: 'Action taken', type: 'select', options: acts.data.filter((a) => a.active || a.id === record?.action_taken_id).map((a) => ({ value: a.id, label: a.name })) },
      { name: 'retraining_required', label: 'Retraining required (counts as an offense)', type: 'checkbox',
        hint: 'Only violations with retraining required count toward offense levels.' },
      { name: 'corrective_action', label: 'Corrective action', type: 'textarea', maxlength: 1000 },
      { name: 'recommendation', label: 'Recommendation', type: 'textarea', maxlength: 1000 },
      { name: 'remarks', label: 'Remarks', type: 'textarea', maxlength: 1000 },
      { name: 'ibas_no', label: 'IBAS no.', type: 'text', maxlength: 60 },
      { name: 'jo_number', label: 'JO number', type: 'text', maxlength: 60 },
    ],
    validate: (v) => (v.violation_date > today ? { violation_date: 'Cannot be in the future.' } : {}),
    onSubmit: async (v) => {
      // soft duplicate check: same technician + same date
      let q = ctx.sb.from('violations').select('id', { count: 'exact', head: true }).eq('technician_id', v.technician_id).eq('violation_date', v.violation_date);
      if (record) q = q.neq('id', record.id);
      const { count, error: e1 } = await q;
      if (e1) throw e1;
      if (count) {
        const ans = await showModal({ title: 'Same-day violation',
          body: el('p', { class: 'muted' }, 'This technician already has a violation on this date. The offense engine counts same-day violations as one offense. Save anyway?'),
          actions: [{ label: 'Go back', value: 'no' }, { label: 'Save anyway', value: 'yes', class: 'btn--primary' }] });
        if (ans !== 'yes') throw new UserError('');
      }
      const { categories, ...rest } = v;
      const payload = { ...rest, client_request_id: requestId };
      const ids = categories.map(Number);
      if (record) {
        const { error } = await ctx.sb.rpc('update_violation', { p_id: record.id, p_version: record.version, p: payload, p_categories: ids });
        if (error) throw error;
        return record.id;
      }
      const { data, error } = await ctx.sb.rpc('create_violation', { p: payload, p_categories: ids });
      if (error) throw error;
      return data;
    },
  });
  return res ? res.result : null;
}
