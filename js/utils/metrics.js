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

// Deployment readiness, reported side by side without changing the rules:
// `eligible` comes from v_offense_status (offense policy only); `trained` from required training.
// off: v_offense_status rows for active staff; per: trainingSummary(...).per; reqCount: number of required types.
export function readiness(off, per, reqCount) {
  const r = { eligible: 0, trained: 0, both: 0, eligibleUntrained: 0, banned: 0, hold: 0, pending: 0, total: off.length, trainingConfigured: reqCount > 0 };
  for (const o of off) {
    const trained = reqCount > 0 && !per.get(o.technician_id)?.missing.length;
    if (o.deployment_eligible) r.eligible++;
    if (trained) r.trained++;
    if (o.deployment_eligible && trained) r.both++;
    if (o.deployment_eligible && reqCount > 0 && !trained) r.eligibleUntrained++;
    if (o.monitoring_status === 'BANNED') r.banned++;
    if (o.hold_until) r.hold++;
    if (Number(o.pending_approvals) > 0) r.pending++;
  }
  return r;
}
