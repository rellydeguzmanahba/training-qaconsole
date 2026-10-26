import { formModal } from '../ui/form.js';
import { el } from '../utils/dom.js';
import { updateVersioned } from '../utils/db.js';
import { todayISO } from '../utils/dates.js';

const fullName = (t) => [t.first_name, t.middle_name, t.surname].filter(Boolean).join(' ');

// Admin only (also enforced by the database trigger guard_employee_status). Nothing is deleted.
export async function openDeactivate(ctx, t) {
  const today = todayISO();
  const r = await formModal({
    title: 'Deactivate employee', submitText: 'Deactivate',
    intro: el('p', { class: 'muted small' }, `${fullName(t)}: the record, training, violations and audit history are kept. The employee stops counting as deployable and in active-staff metrics. An admin can reactivate later.`),
    values: { employment_status: 'Resigned', date_separated: today },
    fields: [
      { name: 'employment_status', label: 'Type', type: 'select', required: true, options: [{ value: 'Resigned', label: 'Resigned' }, { value: 'Terminated', label: 'Terminated' }] },
      { name: 'date_separated', label: 'Effective date', type: 'date', required: true, max: today },
      { name: 'separation_reason', label: 'Reason / notes', type: 'textarea', required: true, maxlength: 300 },
    ],
    validate: (v) => (t.date_hired && v.date_separated < t.date_hired ? { date_separated: 'Cannot be before the date hired.' } : {}),
    onSubmit: (v) => updateVersioned(ctx.sb, 'technicians', t.id, t.version,
      { employment_status: v.employment_status, date_separated: v.date_separated, separation_reason: v.separation_reason }),
  });
  return !!r;
}

export async function openReactivate(ctx, t) {
  const r = await formModal({
    title: 'Reactivate employee', submitText: 'Reactivate',
    intro: el('p', { class: 'muted small' }, `${fullName(t)} will return to active staff. The separation date and reason are cleared from the profile; the audit log keeps them.`),
    values: { employment_status: 'Regular' },
    fields: [{ name: 'employment_status', label: 'New status', type: 'select', required: true,
      options: [{ value: 'Probationary', label: 'Probationary' }, { value: 'Regular', label: 'Regular' }] }],
    onSubmit: (v) => updateVersioned(ctx.sb, 'technicians', t.id, t.version,
      { employment_status: v.employment_status, date_separated: null, separation_reason: null }),
  });
  return !!r;
}
