export const ACTIVE = ['Probationary', 'Regular'];          // staff counted in training / deployment metrics

// techs: [{id}], types: active training types [{id,required}], recs: [{technician_id,training_type_id}]
export function trainingSummary(techs, types, recs) {
  const req = types.filter((t) => t.required);
  const have = new Map();
  for (const r of recs) {
    if (!have.has(r.technician_id)) have.set(r.technician_id, new Set());
    have.get(r.technician_id).add(r.training_type_id);
  }
  const per = new Map();
  let done = 0;
  for (const t of techs) {
    const h = have.get(t.id);
    const completed = req.filter((ty) => h?.has(ty.id));
    const missing = req.filter((ty) => !h?.has(ty.id));
    done += completed.length;
    per.set(t.id, { completed, missing });
  }
  const total = techs.length * req.length;
  return { req, per, done, total, pct: total ? Math.round((100 * done) / total) : 0 };
}

// Violations that require retraining and have no Pending/Passed retraining yet.
export function needingRetraining(violations, retrainings) {
  const covered = new Set(retrainings.filter((r) => r.result !== 'Failed' && r.violation_id).map((r) => r.violation_id));
  return violations.filter((v) => v.retraining_required && v.status !== 'Closed' && !covered.has(v.id));
}
