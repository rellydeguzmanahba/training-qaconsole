import { formModal } from '../ui/form.js';
import { el } from '../utils/dom.js';
import { updateVersioned } from '../utils/db.js';
import { todayISO } from '../utils/dates.js';

const OPEN_STATUSES = ['Applicant', 'Probationary', 'Regular'];

// New record(s): pick one training + date + trainer, tick one or many technicians (e.g. a class session).
// Edit: pass { record } to correct date / trainer / remarks.
// Resolves { inserted, skipped } | { updated: true } | null (cancelled).
export async function openTrainingForm(ctx, { technicianId = null, typeId = null, record = null } = {}) {
  const today = todayISO();
  const baseFields = [
    { name: 'completed_on', label: 'Date completed', type: 'date', required: true, max: today },
    { name: 'trainer', label: 'Trainer', type: 'text', maxlength: 120, hint: 'Name of the person who conducted the training.' },
    { name: 'remarks', label: 'Remarks', type: 'textarea', maxlength: 500 },
  ];

  if (record) {
    const res = await formModal({
      title: 'Edit training record', submitText: 'Save changes', values: record, fields: baseFields,
      intro: el('p', { class: 'muted small' }, `${record.technician_name} — ${record.type_name}`),
      validate: (v) => (v.completed_on > today ? { completed_on: 'Cannot be in the future.' } : {}),
      onSubmit: (v) => updateVersioned(ctx.sb, 'training_records', record.id, record.version,
        { completed_on: v.completed_on, trainer: v.trainer, remarks: v.remarks }),
    });
    return res ? { updated: true } : null;
  }

  const [types, techs] = await Promise.all([
    ctx.sb.from('training_types').select('id,name').eq('active', true).order('sort_order').order('id'),
    ctx.sb.from('technicians').select('id,first_name,surname,employment_status,company:companies(name)')
      .or(`employment_status.in.(${OPEN_STATUSES.join(',')})${technicianId ? `,id.eq.${technicianId}` : ''}`)
      .order('surname').order('first_name'),
  ]);
  if (types.error) throw types.error;
  if (techs.error) throw techs.error;

  const res = await formModal({
    title: 'Record training', submitText: 'Save', wide: true,
    values: { training_type_id: typeId, technicians: technicianId ? [String(technicianId)] : [] },
    fields: [
      { name: 'training_type_id', label: 'Training', type: 'select', required: true, options: types.data.map((t) => ({ value: t.id, label: t.name })) },
      ...baseFields,
      { name: 'technicians', label: 'Technicians', type: 'checks', required: true, scroll: true,
        options: techs.data.map((t) => ({ value: t.id, label: `${t.surname}, ${t.first_name}${t.company?.name ? ` (${t.company.name})` : ''}` })) },
    ],
    validate: (v) => (v.completed_on > today ? { completed_on: 'Cannot be in the future.' } : {}),
    onSubmit: async (v) => {
      const rows = v.technicians.map((id) => ({
        technician_id: id, training_type_id: Number(v.training_type_id), completed_on: v.completed_on,
        trainer: v.trainer, remarks: v.remarks, created_by: ctx.profile.user_id,
      }));
      // The unique key (technician, training, date) makes re-submits harmless: duplicates are skipped, not re-inserted.
      const { data, error } = await ctx.sb.from('training_records')
        .upsert(rows, { onConflict: 'technician_id,training_type_id,completed_on', ignoreDuplicates: true }).select('id');
      if (error) throw error;
      return { inserted: data.length, skipped: rows.length - data.length };
    },
  });
  return res ? res.result : null;
}

export const trainingToast = (ctx, r) => {
  if (!r) return;
  if (r.updated) return ctx.toast('Training record updated.', 'success');
  const msg = `Recorded ${r.inserted} training record${r.inserted === 1 ? '' : 's'}`
    + (r.skipped ? `; ${r.skipped} already recorded for that date were skipped.` : '.');
  ctx.toast(msg, r.inserted ? 'success' : 'info', 6000);
};
