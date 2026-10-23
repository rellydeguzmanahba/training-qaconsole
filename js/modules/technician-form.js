import { formModal } from '../ui/form.js';
import { showModal } from '../ui/dialog.js';
import { el } from '../utils/dom.js';
import { updateVersioned } from '../utils/db.js';
import { UserError } from '../utils/errors.js';
import { nameKey } from '../utils/validate.js';
import { todayISO } from '../utils/dates.js';

export const STATUSES = ['Applicant', 'Probationary', 'Regular', 'Resigned', 'Terminated'];
const SEPARATED = ['Resigned', 'Terminated'];
const opt = (rows) => rows.map((r) => ({ value: r.id, label: r.name }));
const intOrNull = (v) => (v == null ? null : Number(v));

// Opens the add/edit form. `existing` = technician row (with .access = [access_id,...]) or null.
// Resolves with the saved technician row, or null if cancelled.
export async function openTechnicianForm(ctx, existing = null) {
  const [co, de, ac] = await Promise.all(['companies', 'designations', 'access_systems'].map((t) =>
    ctx.sb.from(t).select('id,name,active').order('name')));
  for (const r of [co, de, ac]) if (r.error) throw r.error;
  // Show active items, plus the record's current one even if it was deactivated.
  const keep = (rows, id) => rows.data.filter((x) => x.active || x.id === id);
  const today = todayISO();

  const values = existing ? { ...existing, access: (existing.access || []).map(String) } : { employment_status: 'Probationary', access: [] };

  const res = await formModal({
    title: existing ? 'Edit technician' : 'Add technician', wide: true, submitText: existing ? 'Save changes' : 'Add technician',
    values,
    fields: [
      { name: 'first_name', label: 'First name', type: 'text', required: true, maxlength: 80 },
      { name: 'middle_name', label: 'Middle name', type: 'text', maxlength: 80 },
      { name: 'surname', label: 'Surname', type: 'text', required: true, maxlength: 80 },
      { name: 'birthdate', label: 'Birthdate', type: 'date', max: today },
      { name: 'company_id', label: 'Company', type: 'select', required: true, options: opt(keep(co, existing?.company_id)) },
      { name: 'designation_id', label: 'Designation', type: 'select', required: true, options: opt(keep(de, existing?.designation_id)) },
      { name: 'mobile', label: 'Mobile', type: 'tel', maxlength: 20 },
      { name: 'email', label: 'Email', type: 'email', maxlength: 254 },
      { name: 'employment_status', label: 'Employment status', type: 'select', required: true, options: STATUSES.map((s) => ({ value: s, label: s })) },
      { name: 'date_hired', label: 'Date hired', type: 'date', max: today },
      { name: 'date_separated', label: 'Date separated', type: 'date', max: today,
        visible: (v) => SEPARATED.includes(v.employment_status), required: (v) => SEPARATED.includes(v.employment_status) },
      { name: 'separation_reason', label: 'Separation reason', type: 'text', maxlength: 300, visible: (v) => SEPARATED.includes(v.employment_status) },
      { name: 'lms_user', label: 'LMS username', type: 'text', maxlength: 120 },
      { name: 'lms_login', label: 'LMS login', type: 'text', maxlength: 120 },
      { name: 'access', label: 'Account access', type: 'checks', options: opt(keep(ac, null)) },
    ],
    validate: (v) => {
      const e = {};
      if (v.birthdate && (v.birthdate < '1900-01-01' || v.birthdate >= today)) e.birthdate = 'Enter a valid past date.';
      if (v.date_hired && v.date_hired > today) e.date_hired = 'Cannot be in the future.';
      if (v.date_separated && v.date_separated > today) e.date_separated = 'Cannot be in the future.';
      if (v.date_hired && v.date_separated && v.date_separated < v.date_hired) e.date_separated = 'Cannot be before the date hired.';
      return e;
    },
    onSubmit: async (v) => {
      const payload = {
        first_name: v.first_name, middle_name: v.middle_name, surname: v.surname,
        birthdate: v.birthdate, date_hired: v.date_hired,
        company_id: intOrNull(v.company_id), designation_id: intOrNull(v.designation_id),
        mobile: v.mobile, email: v.email ? v.email.toLowerCase() : null,
        employment_status: v.employment_status, date_separated: v.date_separated, separation_reason: v.separation_reason,
        lms_user: v.lms_user, lms_login: v.lms_login,
      };

      // 1) hard duplicate: same first name + surname
      const key = nameKey(v.first_name, v.surname);
      const { data: same, error: e1 } = await ctx.sb.from('technicians').select('id').eq('name_key', key);
      if (e1) throw e1;
      if (same.some((r) => r.id !== existing?.id)) {
        throw new UserError('A technician with this first name and surname already exists.', { first_name: 'Duplicate technician name.', surname: 'Duplicate technician name.' });
      }
      // 2) soft duplicate: same mobile or email -> ask
      const filters = [];
      if (payload.mobile) filters.push(`mobile.eq.${payload.mobile.replace(/[,()]/g, '')}`);
      if (payload.email) filters.push(`email.eq.${payload.email.replace(/[,()]/g, '')}`);
      if (filters.length) {
        const { data: sim, error: e2 } = await ctx.sb.from('technicians').select('id,first_name,surname').or(filters.join(','));
        if (e2) throw e2;
        const others = sim.filter((r) => r.id !== existing?.id);
        if (others.length) {
          const ans = await showModal({ title: 'Possible duplicate',
            body: el('p', { class: 'muted' }, `The same mobile or email is already used by ${others.map((o) => `${o.first_name} ${o.surname}`).join(', ')}. Save anyway?`),
            actions: [{ label: 'Go back', value: 'no' }, { label: 'Save anyway', value: 'yes', class: 'btn--primary' }] });
          if (ans !== 'yes') throw new UserError('');   // keep the form open, no message
        }
      }

      let rec;
      try {
        if (existing) rec = await updateVersioned(ctx.sb, 'technicians', existing.id, existing.version, payload);
        else {
          const { data, error } = await ctx.sb.from('technicians').insert({ ...payload, created_by: ctx.profile.user_id }).select().single();
          if (error) throw error;
          rec = data;
        }
      } catch (err) {
        if (err.code === '23505') throw new UserError('A technician with this first name and surname already exists.', { first_name: 'Duplicate technician name.' });
        throw err;
      }

      // account access: apply only the differences
      const want = new Set(v.access.map(Number));
      const have = new Set((existing?.access || []).map(Number));
      const add = [...want].filter((x) => !have.has(x)).map((access_id) => ({ technician_id: rec.id, access_id }));
      const del = [...have].filter((x) => !want.has(x));
      if (add.length) { const { error } = await ctx.sb.from('technician_access').insert(add); if (error) throw error; }
      if (del.length) { const { error } = await ctx.sb.from('technician_access').delete().eq('technician_id', rec.id).in('access_id', del); if (error) throw error; }
      return rec;
    },
  });
  return res ? res.result : null;
}
