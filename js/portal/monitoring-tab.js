import { el } from '../utils/dom.js';
import { badge } from '../ui/badge.js';
import { emptyState, errorState } from '../ui/states.js';
import { friendlyError } from '../utils/errors.js';
import { fmtDate, todayISO } from '../utils/dates.js';
import { monitoringView, buildTimeline, ordinal } from '../portal/model.js';

// Monitoring Days: summary + interactive timeline. Dates and rules come from the offense engine (my_monitoring / my_penalties).
export async function renderMonitoring(root, ctx) {
  const { sb } = ctx;
  const [mon, pen] = await Promise.all([sb.rpc('my_monitoring'), sb.rpc('my_penalties')]);
  for (const r of [mon, pen]) if (r.error) { root.append(errorState(friendlyError(r.error), () => location.reload())); return; }
  const m = mon.data?.[0] ?? null, today = todayISO();
  const mv = monitoringView(m), tl = buildTimeline({ penalties: pen.data, monitoring: m, today });

  const stat = (label, value, sub) => el('div', { class: 'card' }, el('div', { class: 'card__title' }, label), el('div', { class: 'stat' }, value), sub ? el('div', { class: 'stat-sub' }, sub) : null);
  const head = el('header', { class: 'portal-welcome' }, el('h2', {}, 'Monitoring Days'),
    el('p', { class: 'muted' }, mv.state === 'monitoring' ? 'Your current monitoring period.' : mv.state === 'banned' ? 'Your record is under a ban.' : 'You are not currently being monitored.'));
  if (mv.state === 'none' && !tl) { root.append(head, el('div', { class: 'card' }, emptyState({ icon: 'check', title: 'No monitoring', text: 'You have no offenses on record.' }))); return; }

  const summary = el('div', { class: 'grid grid--cards' },
    stat('Start', mv.start ? fmtDate(mv.start) : '—', 'last offense date'), stat('End', mv.state === 'banned' ? 'No end date' : mv.end ? fmtDate(mv.end) : '—'),
    stat('Total days', mv.total ?? '—'), stat('Elapsed', mv.state === 'monitoring' ? mv.elapsed : '—'), stat('Remaining', mv.state === 'monitoring' ? mv.remaining : '—'),
    stat('Offense level', mv.level ? ordinal(mv.level) : '—', mv.penalty || null));
  const bar = mv.state === 'monitoring' ? el('div', { class: 'bar', role: 'img', 'aria-label': `${mv.pct}% of the monitoring period elapsed` }, el('span', { style: `width:${mv.pct}%` })) : null;

  // ---- interactive timeline
  const detail = el('div', { class: 'card pen', 'aria-live': 'polite' });
  const showLane = (l, btn) => {
    document.querySelectorAll('.tl-lane').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    detail.replaceChildren(el('div', { class: 'row', style: 'justify-content:space-between' }, el('strong', {}, `${ordinal(l.offense_no)} offense`),
      l.banned ? badge('Ban', 'red') : badge(l.state === 'active' ? 'Active' : l.state === 'escalated' ? 'Escalated' : 'Completed', l.state === 'active' ? 'amber' : l.state === 'completed' ? 'green' : 'blue')),
      el('p', {}, l.penalty), el('div', { class: 'small muted' }, `Offense ${fmtDate(l.start)} · monitoring until ${l.banned ? 'lifted by a supervisor' : fmtDate(l.end)}`),
      l.hold_until ? el('div', { class: 'small muted' }, `Deployment hold until ${fmtDate(l.hold_until)}`) : null,
      l.approval_status ? el('div', { class: 'small muted' }, l.approval_status === 'approved' ? (l.lifted ? 'Approved, then lifted' : 'Approved by a supervisor') : 'Awaiting supervisor approval') : null);
  };
  let timeline = null, history = null;
  if (tl) {
    const lanes = tl.lanes.map((l) => el('div', { class: 'tl-row' },
      el('span', { class: 'tl-row__label' }, ordinal(l.offense_no)),
      el('div', { class: 'tl-row__track' },
        l.holdWidth != null ? el('span', { class: 'tl-hold', style: `left:${l.holdLeft}%;width:${l.holdWidth}%`, 'aria-hidden': 'true' }) : null,
        el('button', { type: 'button', class: `tl-lane tl-lane--${l.banned ? 'ban' : l.state}`, style: `left:${l.left}%;width:${l.width}%`, 'aria-pressed': 'false',
          'aria-label': `${ordinal(l.offense_no)} offense, ${fmtDate(l.start)} to ${l.banned ? 'ban lifted' : fmtDate(l.end)}. ${l.penalty}`, onclick: (e) => showLane(l, e.currentTarget) }))));
    timeline = el('section', { class: 'card portal-card', 'aria-label': 'Monitoring timeline' }, el('h3', { class: 'portal-card__title' }, 'Timeline'),
      el('div', { class: 'tl' }, tl.todayInRange ? el('span', { class: 'tl-today', style: `left:calc(42px + (100% - 42px) * ${tl.todayPct / 100})`, 'aria-label': 'Today' }, el('i', {}, 'Today')) : null, lanes),
      el('div', { class: 'tl-axis small muted' }, el('span', {}, fmtDate(tl.axisStart)), el('span', {}, `${tl.days}-day windows`), el('span', {}, fmtDate(tl.axisEnd))), detail);
    const last = tl.lanes[tl.lanes.length - 1];
    showLane(last, timeline.querySelectorAll('.tl-lane')[tl.lanes.length - 1]);
    if (tl.history.length) history = el('section', { class: 'card portal-card', 'aria-label': 'Monitoring history' }, el('h3', { class: 'portal-card__title' }, 'Earlier monitoring'),
      el('ul', { class: 'list' }, tl.history.map((h) => el('li', {}, el('span', {}, el('strong', {}, `${ordinal(h.offense_no)} offense`), el('div', { class: 'small muted' }, `${fmtDate(h.start)} to ${fmtDate(h.end)} · ${h.penalty}`)), badge('Completed', 'green')))));
  }
  root.append(head, summary, bar ? el('div', { class: 'card' }, bar, el('p', { class: 'small muted', style: 'margin-top:6px' }, `Day ${mv.elapsed} of ${mv.total}`)) : null,
    m?.hold_until && m.hold_until >= today ? el('div', { class: 'callout' }, `Deployment hold in effect until ${fmtDate(m.hold_until)}.`) : null, timeline, history);
}
