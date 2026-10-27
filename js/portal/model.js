// Pure helpers for the technician dashboard (no DOM, no network): monitoring view model and derived notices.
const ymd = (v) => (v ? String(v).slice(0, 10) : '');
const ORD = ['', '1st', '2nd', '3rd', '4th', '5th'];
export const ordinal = (n) => ORD[n] || `${n}th`;

// m: row from my_monitoring() or null
export function monitoringView(m) {
  if (!m || m.monitoring_status === 'No offense') return { state: 'none' };
  const base = { status: m.monitoring_status, level: m.current_offense_no, penalty: m.current_penalty, deployment: m.deployment_status,
    holdUntil: m.hold_until, pending: Number(m.pending_approvals || 0), start: m.last_offense_date, end: m.monitoring_until, total: m.monitoring_days, chainStart: m.chain_start };
  if (m.monitoring_status === 'BANNED') return { ...base, state: 'banned' };
  if (m.monitoring_status === 'CLEARED') return { ...base, state: 'cleared' };
  const elapsed = Number(m.elapsed_days ?? 0), total = Number(m.monitoring_days || 0);
  return { ...base, state: 'monitoring', elapsed, remaining: Number(m.remaining_days ?? Math.max(0, total - elapsed)), pct: total ? Math.round((100 * elapsed) / total) : 0 };
}

// Notices are derived from the technician's own records (server-side events arrive with the push phase).
export function buildNotices({ violations = [], penalties = [], retrainings = [], monitoring = null, today }) {
  const out = [];
  for (const v of violations.slice(0, 10)) {
    out.push({ id: `v:${v.id}`, at: ymd(v.created_at || v.violation_date), tab: 'violations', tone: v.severity === 'Minor' ? 'info' : 'warn',
      title: 'New QA violation', text: `${ymd(v.violation_date)} · ${v.severity}${v.category_codes?.length ? ` · ${v.category_codes.join(', ')}` : ''}` });
  }
  for (const p of penalties) {
    const key = `p:${p.offense_date}`;
    if (p.approval_status === 'proposed') out.push({ id: `${key}:pending`, at: ymd(p.offense_date), tab: 'penalties', tone: 'warn', title: 'Penalty awaiting approval', text: `${ordinal(p.offense_no)} offense: ${p.penalty}` });
    else if (p.approval_status === 'approved' && p.enforced) out.push({ id: `${key}:in-effect`, at: ymd(p.offense_date), tab: 'penalties', tone: 'bad', title: 'Penalty approved', text: `${ordinal(p.offense_no)} offense: ${p.penalty}${p.hold_until ? `, hold until ${ymd(p.hold_until)}` : ''}` });
    else if (p.approval_status === 'approved' && p.hold_until && ymd(p.hold_until) < today) out.push({ id: `${key}:hold-ended`, at: ymd(p.hold_until), tab: 'penalties', tone: 'good', title: 'Deployment hold ended', text: `Hold from ${ymd(p.offense_date)} ended ${ymd(p.hold_until)}` });
  }
  for (const r of retrainings.slice(0, 10)) {
    const t = { Pending: ['Retraining assigned', 'warn'], Passed: ['Retraining passed', 'good'], Failed: ['Retraining not passed', 'bad'] }[r.result] || ['Retraining update', 'info'];
    out.push({ id: `r:${r.id}:${r.result}`, at: ymd(r.created_at), tab: 'dashboard', tone: t[1], title: t[0], text: r.training + (r.retraining_date ? ` · ${ymd(r.retraining_date)}` : '') });
  }
  const mv = monitoringView(monitoring);
  if (mv.state === 'monitoring' && mv.remaining <= 7) out.push({ id: `m:${mv.end}:soon`, at: today, tab: 'monitoring', tone: 'info', title: 'Monitoring period ending soon', text: `${mv.remaining} day${mv.remaining === 1 ? '' : 's'} remaining (ends ${ymd(mv.end)})` });
  if (mv.state === 'cleared') out.push({ id: `m:${mv.end}:done`, at: ymd(mv.end), tab: 'monitoring', tone: 'good', title: 'Monitoring period completed', text: `Completed ${ymd(mv.end)}` });
  if (mv.state === 'monitoring' || mv.state === 'banned') if (mv.holdUntil && ymd(mv.holdUntil) >= today) out.push({ id: `h:${ymd(mv.holdUntil)}`, at: today, tab: 'penalties', tone: 'bad', title: 'Deployment hold active', text: `Until ${ymd(mv.holdUntil)}` });
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20);
}
