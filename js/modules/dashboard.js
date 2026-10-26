import { el } from '../utils/dom.js';
import { badge, deploymentVariant } from '../ui/badge.js';
import { ringGauge, hbars, columns } from '../ui/charts.js';
import { mountHero } from '../ui/hero3d.js';
import { ensureCss } from '../utils/styles.js';
import { fetchAll } from '../utils/db.js';
import { friendlyError } from '../utils/errors.js';
import { fmtDateTime, todayISO } from '../utils/dates.js';
import { APP } from '../config.js';
import { ACTIVE, trainingSummary, needingRetraining, readiness } from '../utils/metrics.js';

let hero = null;
export function destroy() { hero?.destroy(); hero = null; }       // called by the router on navigation

const nm = (t) => (t ? `${t.first_name} ${t.surname}` : 'Unknown');
const kpi = (href, label, value, sub, tone = '') => el('a', { class: `stat-link kpi${tone ? ` kpi--${tone}` : ''}`, href },
  el('div', { class: 'card' }, el('div', { class: 'card__title' }, label), el('div', { class: 'stat' }, value), sub ? el('div', { class: 'stat-sub' }, sub) : null));
const section = (title, desc, ...kids) => el('section', { class: 'dash-section', 'aria-label': title },
  el('header', {}, el('h3', {}, title), desc ? el('p', {}, desc) : null), ...kids);
const panel = (title, ...kids) => el('div', { class: 'card' }, el('div', { class: 'card__title' }, title), ...kids);
const countBy = (rows, key) => { const m = new Map(); for (const r of rows) m.set(key(r), (m.get(key(r)) || 0) + 1); return [...m].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value); };

export async function render(root, ctx) {
  destroy();
  ensureCss('css/dashboard.css');
  const { sb } = ctx;
  let d;
  try {
    const [techs, types, recs, viol, ret, off, rv, rt, rr] = await Promise.all([
      fetchAll(() => sb.from('technicians').select('id,employment_status,company:companies(name),designation:designations(name)').order('id')),
      sb.from('training_types').select('id,name,required').eq('active', true).order('sort_order').order('id'),
      fetchAll(() => sb.from('training_records').select('id,technician_id,training_type_id').order('id')),
      fetchAll(() => sb.from('violations').select('id,status,severity,violation_date,retraining_required,technician_id').order('id')),
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

  // ---------- metrics (all recalculated from the database; no stored totals) ----------
  const today = todayISO();
  const active = d.techs.filter((t) => ACTIVE.includes(t.employment_status));
  const activeIds = new Set(active.map((t) => t.id));
  const status = (s) => d.techs.filter((t) => t.employment_status === s).length;
  const ts = trainingSummary(active, d.types, d.recs);
  const trainingOn = ts.req.length > 0;
  const withMissing = active.filter((t) => ts.per.get(t.id).missing.length).length;
  const fully = trainingOn ? active.length - withMissing : 0;
  const open = d.viol.filter((v) => v.status !== 'Closed');
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 30 * 864e5).toISOString().slice(0, 10);
  const needs = needingRetraining(d.viol, d.ret);
  const count = (arr, f) => arr.filter(f).length;
  const offActive = d.off.filter((o) => activeIds.has(o.technician_id));
  const rd = readiness(offActive, ts.per, ts.req.length);
  const monitoring = count(d.off, (o) => o.monitoring_status === 'UNDER MONITORING');
  const banned = count(d.off, (o) => o.monitoring_status === 'BANNED');
  const hold = count(d.off, (o) => o.hold_until);
  const awaiting = d.off.reduce((n, o) => n + Number(o.pending_approvals || 0), 0);
  const review = d.off.filter((o) => o.requires_review);

  const holders = new Map();
  for (const r of d.recs) { if (!holders.has(r.training_type_id)) holders.set(r.training_type_id, new Set()); holders.get(r.training_type_id).add(r.technician_id); }
  const byType = d.types.map((ty) => ({ label: ty.name + (ty.required ? '' : ' (optional)'),
    value: active.length ? Math.round((100 * active.filter((t) => holders.get(ty.id)?.has(t.id)).length) / active.length) : 0 }));

  const [Y, M] = today.split('-').map(Number);
  const months = Array.from({ length: 6 }, (_, i) => new Date(Date.UTC(Y, M - 1 - (5 - i), 1)).toISOString().slice(0, 7));
  const perMonth = months.map((m) => ({ label: new Date(`${m}-01T00:00:00Z`).toLocaleString('en-PH', { month: 'short', timeZone: 'UTC' }), value: count(d.viol, (v) => v.violation_date.slice(0, 7) === m) }));

  const feed = [
    ...d.rv.map((x) => ({ at: x.created_at, href: `#/violations/${x.id}`, text: `Violation recorded: ${nm(x.technician)} (${x.severity})` })),
    ...d.rt.map((x) => ({ at: x.created_at, href: '#/training', text: `Training recorded: ${nm(x.technician)}, ${x.training_types?.name ?? ''}` })),
    ...d.rr.map((x) => ({ at: x.created_at, href: x.violation_id ? `#/violations/${x.violation_id}` : '#/retraining', text: `Retraining ${x.result.toLowerCase()}: ${nm(x.technician)}` })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10);

  // ---------- hero ----------
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: APP.timezone }).format(new Date()));
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const dateText = new Intl.DateTimeFormat('en-PH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: APP.timezone }).format(new Date());
  const chip = (label, v) => el('span', { class: 'hero__chip' }, el('b', {}, v), label);
  const stage = el('div', { class: 'hero__stage' });
  const actions = [
    ctx.can('violations:write') ? el('a', { class: 'btn btn--primary', href: '#/violations' }, 'QA violations') : null,
    ctx.can('training:write') ? el('a', { class: 'btn', href: '#/training' }, 'Training') : null,
    ctx.can('offenses:decide') && awaiting ? el('a', { class: 'btn', href: '#/offenses' }, `Review ${awaiting} approval${awaiting === 1 ? '' : 's'}`) : null,
    el('a', { class: 'btn btn--ghost', href: '#/reports' }, 'Reports'),
  ];
  const heroEl = el('section', { class: 'card hero', 'aria-label': 'Operations command center' },
    el('div', { class: 'hero__copy' }, el('span', { class: 'eyebrow' }, 'AHBA Operations Command Center'),
      el('h2', {}, `${greet}, ${(ctx.profile.full_name || '').split(' ')[0] || 'there'}`), el('p', { class: 'muted' }, dateText),
      el('div', { class: 'hero__chips' }, chip('active staff', active.length), chip('deployable', rd.eligible), chip('open violations', open.length), chip('awaiting approval', awaiting)),
      el('div', { class: 'hero__actions' }, actions)),
    stage);

  // ---------- sections ----------
  const noTraining = el('div', { class: 'callout' }, 'No required training types are configured, so completion cannot be calculated. An admin can set them in Settings → Training types.');
  const workforce = section('Workforce overview', 'Employee records by status, company and designation (active staff).',
    el('div', { class: 'kpis' },
      kpi('#/technicians', 'Employee records', d.techs.length, `${active.length} active staff`),
      kpi('#/technicians', 'Regular', status('Regular'), null), kpi('#/technicians', 'Probationary', status('Probationary'), null, 'gold'),
      kpi('#/technicians', 'Deactivated', status('Resigned') + status('Terminated'), `${status('Resigned')} resigned · ${status('Terminated')} terminated`, 'muted')),
    el('div', { class: 'panels', style: 'margin-top:14px' },
      panel('By company', hbars(countBy(active, (t) => t.company?.name ?? 'Unassigned').slice(0, 8))),
      panel('By designation', hbars(countBy(active, (t) => t.designation?.name ?? 'Unassigned').slice(0, 8)))));

  const training = section('Training & compliance', 'Required training types only; active staff.',
    trainingOn ? el('div', { class: 'panels' },
      panel('Required training completion', el('div', { class: 'gauge' }, ringGauge(ts.pct, { label: 'Completion' }),
        el('div', { class: 'legend' }, el('span', {}, el('b', {}, ts.done), ` of ${ts.total} required trainings completed`),
          el('span', {}, el('b', {}, fully), ' fully trained'), el('span', {}, el('b', {}, withMissing), ' with missing training'),
          el('span', {}, el('b', {}, ts.req.length), ' required types')))),
      panel('Completion by training type', hbars(byType, { max: 100, suffix: '%' }))) : noTraining);

  const violations = section('QA violations', 'Status, severity and monthly trend.',
    el('div', { class: 'kpis' },
      kpi('#/violations', 'Open', count(d.viol, (v) => v.status === 'Open'), null, 'gold'), kpi('#/violations', 'For retraining', count(d.viol, (v) => v.status === 'For Retraining'), null),
      kpi('#/violations', 'Resolved', d.viol.length - open.length, 'closed violations', 'muted'), kpi('#/violations', 'Last 30 days', count(d.viol, (v) => v.violation_date >= since), 'reported')),
    el('div', { class: 'panels', style: 'margin-top:14px' },
      panel('Violations – last 6 months', columns(perMonth, 'Violations per month')),
      panel('Open by severity', hbars(['Critical', 'Major', 'Minor'].map((s) => ({ label: s, value: count(open, (v) => v.severity === s) })), { max: Math.max(1, open.length) }))));

  const retraining = section('Retraining', 'Assignments and outcomes.',
    el('div', { class: 'kpis' },
      kpi('#/retraining', 'Needs assignment', needs.length, 'violations awaiting retraining', needs.length ? 'gold' : ''), kpi('#/retraining', 'Pending', count(d.ret, (r) => r.result === 'Pending'), null),
      kpi('#/retraining', 'Passed', count(d.ret, (r) => r.result === 'Passed'), null), kpi('#/retraining', 'Failed', count(d.ret, (r) => r.result === 'Failed'), null, 'red')));

  const offenses = section('Offense monitoring', 'Current offense levels and decisions waiting on a supervisor.',
    el('div', { class: 'kpis' },
      kpi('#/offenses', 'Under monitoring', monitoring, null, 'gold'), kpi('#/offenses', 'Awaiting approval', awaiting, 'holds / bans proposed', awaiting ? 'gold' : ''),
      kpi('#/offenses', 'On hold', hold, 'approved deployment holds'), kpi('#/offenses', 'Banned', banned, null, banned ? 'red' : 'muted'),
      kpi('#/offenses', 'Needs review', review.length, null)),
    el('div', { style: 'margin-top:14px' }, panel('Needs attention', review.length
      ? el('ul', { class: 'list' }, review.slice(0, 8).map((o) => el('li', {}, el('a', { href: `#/technicians/${o.technician_id}` }, o.full_name),
        el('span', { class: 'row', style: 'gap:6px;justify-content:flex-end' }, o.review_reason ? el('span', { class: 'small muted' }, o.review_reason) : null,
          badge(o.deployment_status, deploymentVariant(o.deployment_status))))))
      : el('p', { class: 'muted' }, 'Nothing needs review right now.'))));

  const readyKpis = [
    kpi('#/offenses', 'Deployable (offense policy)', `${rd.eligible}/${active.length}`, 'what the system enforces today'),
    ...(rd.trainingConfigured ? [kpi('#/training', 'Fully trained', `${rd.trained}/${active.length}`, 'all required training complete'),
      kpi('#/training', 'Deployable and fully trained', `${rd.both}/${active.length}`, null),
      kpi('#/training', 'Deployable, training incomplete', rd.eligibleUntrained, 'not a blocker under current rules', rd.eligibleUntrained ? 'gold' : 'muted')] : []),
    kpi('#/offenses', 'On hold / banned', `${rd.hold} / ${rd.banned}`, null, 'muted'),
  ];
  const readiness_ = section('Deployment readiness', 'Shown side by side so the training gap is visible. No rules were changed.',
    el('div', { class: 'kpis' }, readyKpis),
    el('div', { class: 'callout callout--info', style: 'margin-top:14px' }, 'Deployment eligibility currently follows offense monitoring only (approved holds and bans, and separation). Required training does not block deployment. Confirm whether that is the intended policy.'),
    el('details', { class: 'explain' }, el('summary', {}, 'How eligibility is calculated'),
      el('p', {}, 'deployment_eligible = ', el('code', {}, 'not banned and no active approved hold and status not Resigned/Terminated'), '. Proposed (unapproved) holds or bans do not restrict deployment until a supervisor approves them. See docs/deployment-eligibility.md.')));

  const activity = section('Recent activities', null,
    panel('Latest updates', feed.length
      ? el('ul', { class: 'list feed' }, feed.map((f) => el('li', {}, el('a', { href: f.href }, f.text), el('span', { class: 'small muted' }, fmtDateTime(f.at)))))
      : el('p', { class: 'muted' }, 'No activity yet.')));

  root.classList.add('dash');
  root.append(heroEl, workforce, training, violations, retraining, offenses, readiness_, activity);
  hero = mountHero(stage);                                  // waits until the page is attached, then starts
}
