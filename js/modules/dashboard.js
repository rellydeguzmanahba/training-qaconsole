import { el } from '../utils/dom.js';
import { badge, deploymentVariant } from '../ui/badge.js';
import { fetchAll } from '../utils/db.js';
import { friendlyError } from '../utils/errors.js';
import { fmtDate, fmtDateTime, todayISO } from '../utils/dates.js';
import { ACTIVE, trainingSummary, needingRetraining } from '../utils/metrics.js';

const nm = (t) => (t ? `${t.first_name} ${t.surname}` : 'Unknown');

export async function render(root, ctx) {
  const { sb } = ctx;
  let d;
  try {
    const [techs, types, recs, viol, ret, off, rv, rt, rr] = await Promise.all([
      fetchAll(() => sb.from('technicians').select('id,employment_status').order('id')),
      sb.from('training_types').select('id,name,required').eq('active', true).order('sort_order').order('id'),
      fetchAll(() => sb.from('training_records').select('id,technician_id,training_type_id').order('id')),
      fetchAll(() => sb.from('violations').select('id,status,severity,violation_date,retraining_required').order('id')),
      fetchAll(() => sb.from('retrainings').select('id,violation_id,result').order('id')),
      fetchAll(() => sb.from('v_offense_status').select('*').order('technician_id')),
      sb.from('violations').select('id,created_at,severity,technician:technicians(first_name,surname)').order('created_at', { ascending: false }).limit(8),
      sb.from('training_records').select('id,created_at,technician:technicians(first_name,surname),training_types(name)').order('created_at', { ascending: false }).limit(8),
      sb.from('retrainings').select('id,created_at,result,violation_id,technician:technicians(first_name,surname)').order('created_at', { ascending: false }).limit(8),
    ]);
    for (const r of [types, rv, rt, rr]) if (r.error) throw r.error;
    d = { techs, types: types.data, recs, viol, ret, off, rv: rv.data, rt: rt.data, rr: rr.data };
  } catch (e) {
    console.error(e);
    root.append(el('div', { class: 'alert alert--error' }, friendlyError(e), ' ', el('button', { class: 'btn btn--sm', type: 'button', onclick: () => location.reload() }, 'Retry')));
    return;
  }

  // ---- metrics (always recalculated from the database)
  const active = d.techs.filter((t) => ACTIVE.includes(t.employment_status));
  const ts = trainingSummary(active, d.types, d.recs);
  const withMissing = active.filter((t) => ts.per.get(t.id).missing.length).length;
  const open = d.viol.filter((v) => v.status !== 'Closed');
  const needs = needingRetraining(d.viol, d.ret);
  const pendingRet = d.ret.filter((r) => r.result === 'Pending').length;
  const failedRet = d.ret.filter((r) => r.result === 'Failed').length;
  const activeIds = new Set(active.map((t) => t.id));
  const offActive = d.off.filter((o) => activeIds.has(o.technician_id));
  const eligible = offActive.filter((o) => o.deployment_eligible).length;
  const banned = d.off.filter((o) => o.monitoring_status === 'BANNED').length;
  const hold = d.off.filter((o) => o.hold_until).length;
  const monitoring = d.off.filter((o) => o.monitoring_status === 'UNDER MONITORING').length;
  const awaiting = d.off.reduce((n, o) => n + Number(o.pending_approvals || 0), 0);
  const review = d.off.filter((o) => o.requires_review);

  const card = (href, title, value, sub) => el('a', { class: 'stat-link', href },
    el('div', { class: 'card' }, el('div', { class: 'card__title' }, title), el('div', { class: 'stat' }, value), sub ? el('div', { class: 'stat-sub' }, sub) : null));
  const panel = (title, ...kids) => el('div', { class: 'card' }, el('div', { class: 'card__title' }, title), ...kids);

  // ---- training completion by type (share of active staff with the training)
  const holders = new Map();
  for (const r of d.recs) { if (!holders.has(r.training_type_id)) holders.set(r.training_type_id, new Set()); holders.get(r.training_type_id).add(r.technician_id); }
  const byType = d.types.map((ty) => {
    const set = holders.get(ty.id);
    const c = set ? active.filter((t) => set.has(t.id)).length : 0;
    return { ty, pct: active.length ? Math.round((100 * c) / active.length) : 0 };
  });

  // ---- violations per month (last 6 months)
  const [Y, M] = todayISO().split('-').map(Number);
  const months = Array.from({ length: 6 }, (_, i) => { const dt = new Date(Date.UTC(Y, M - 1 - (5 - i), 1)); return dt.toISOString().slice(0, 7); });
  const perMonth = months.map((m) => ({ m, n: d.viol.filter((v) => v.violation_date.slice(0, 7) === m).length }));
  const max = Math.max(1, ...perMonth.map((x) => x.n));
  const monthLabel = (m) => new Date(`${m}-01T00:00:00Z`).toLocaleString('en-PH', { month: 'short', timeZone: 'UTC' });

  // ---- recent activity (violations, training, retraining; visible to every role)
  const feed = [
    ...d.rv.map((x) => ({ at: x.created_at, href: `#/violations/${x.id}`, text: `Violation recorded — ${nm(x.technician)} (${x.severity})` })),
    ...d.rt.map((x) => ({ at: x.created_at, href: '#/training', text: `Training recorded — ${nm(x.technician)}: ${x.training_types?.name ?? ''}` })),
    ...d.rr.map((x) => ({ at: x.created_at, href: x.violation_id ? `#/violations/${x.violation_id}` : '#/retraining', text: `Retraining ${x.result.toLowerCase()} — ${nm(x.technician)}` })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10);

  root.append(
    el('div', { class: 'page-head' }, el('div', {}, el('h2', {}, 'Dashboard'),
      el('p', { class: 'muted small' }, 'Live figures calculated from the database. Training and deployment metrics cover active staff (probationary and regular).'))),

    el('div', { class: 'grid grid--cards' },
      card('#/technicians', 'Technicians', d.techs.length, `${active.length} active staff`),
      card('#/training', 'Training completion', `${ts.pct}%`, `${ts.done} of ${ts.total} required trainings`),
      card('#/training', 'Pending training', withMissing, `technicians with missing training`),
      card('#/violations', 'Open violations', open.length, `${d.viol.length - open.length} resolved`),
      card('#/retraining', 'Retraining required', needs.length, `${pendingRet} pending · ${failedRet} failed`),
      card('#/offenses', 'Under monitoring', monitoring, `${banned} banned · ${hold} on hold`),
      card('#/offenses', 'Awaiting approval', awaiting, `${review.length} technician${review.length === 1 ? '' : 's'} need review`),
      card('#/offenses', 'Deployable', `${eligible}/${active.length}`, 'active staff eligible for deployment')),

    el('div', { class: 'grid grid--2' },
      panel('Training completion by type', ...(byType.length ? byType.map((b) => el('div', { class: 'bar-row' },
        el('span', {}, b.ty.name, b.ty.required ? null : el('span', { class: 'muted' }, ' (optional)')),
        el('div', { class: 'bar' }, el('span', { style: `width:${b.pct}%` })), el('span', { class: 'small' }, `${b.pct}%`)))
        : [el('p', { class: 'muted' }, 'No training types configured.')])),
      panel('Violations – last 6 months',
        el('div', { class: 'cols', role: 'img', 'aria-label': 'Violations per month' }, perMonth.map((x) =>
          el('div', { class: 'col' }, el('b', {}, x.n), el('span', { style: `height:${Math.round((100 * x.n) / max)}%` }), monthLabel(x.m)))),
        el('div', { class: 'row small muted', style: 'margin-top:12px' },
          ['Minor', 'Major', 'Critical'].map((s) => `${s}: ${open.filter((v) => v.severity === s).length} open`).join(' · ')))),

    el('div', { class: 'grid grid--2' },
      panel('Needs attention', review.length
        ? el('ul', { class: 'list' }, review.slice(0, 8).map((o) => el('li', {},
          el('a', { href: `#/technicians/${o.technician_id}` }, o.full_name),
          el('span', { class: 'row', style: 'gap:6px;justify-content:flex-end' }, o.review_reason ? el('span', { class: 'small muted' }, o.review_reason) : null,
            badge(o.deployment_status, deploymentVariant(o.deployment_status))))))
        : el('p', { class: 'muted' }, 'Nothing needs review right now.'),
        review.length > 8 ? el('p', { class: 'small', style: 'margin-top:8px' }, el('a', { href: '#/offenses' }, `View all ${review.length}`)) : null),
      panel('Recent activity', feed.length
        ? el('ul', { class: 'list' }, feed.map((f) => el('li', {}, el('a', { href: f.href }, f.text), el('span', { class: 'small muted' }, fmtDateTime(f.at)))))
        : el('p', { class: 'muted' }, 'No activity yet.'))));
}
