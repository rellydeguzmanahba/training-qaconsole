import { el } from '../utils/dom.js';
import { badge, SEVERITY_VARIANT, VIOLATION_STATUS_VARIANT, RESULT_VARIANT } from '../ui/badge.js';
import { errorState, emptyState } from '../ui/states.js';
import { icon } from '../ui/icons.js';
import { mountIdCard } from '../ui/id-card3d.js';
import { getKeyedLogoUrl } from '../ui/brand.js';
import { ensureCss } from '../utils/styles.js';
import { friendlyError } from '../utils/errors.js';
import { fmtDate, todayISO } from '../utils/dates.js';
import { APP } from '../config.js';
import { monitoringView, buildNotices, ordinal } from '../portal/model.js';
import { getPortal } from '../portal/data.js';
import { syncBanner, deviceCard } from '../portal/chrome.js';

// Technician portal. Every read goes through the whitelisted v_my_* views / my_*() functions (migration 010b):
// the server derives the technician from the signed-in account; no technician id is ever sent from the browser.
const TABS = [['dashboard', 'Dashboard', 'grid'], ['violations', 'Violation History', 'alert'], ['penalties', 'Penalties', 'shield'], ['monitoring', 'Monitoring Days', 'refresh']];
let card = null, nav = null, gen = 0;
export function destroy() { gen++; card?.destroy(); card = null; }

function setNav(tab) {
  const app = document.getElementById('app');
  if (!nav || !nav.isConnected) {
    nav = el('nav', { class: 'portal-nav', 'aria-label': 'Technician portal' }, TABS.map(([id, label, ic]) =>
      el('a', { href: `#/${id}`, dataset: { tab: id } }, icon(ic, 22), el('span', {}, label))));
    app.append(nav);
  }
  nav.querySelectorAll('a').forEach((a) => (a.dataset.tab === tab ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
}

const readKey = (uid) => `ahba.portal.read.${uid}`;
const loadRead = (uid) => { try { return new Set(JSON.parse(localStorage.getItem(readKey(uid)) || '[]')); } catch { return new Set(); } };
const saveRead = (uid, set) => { try { localStorage.setItem(readKey(uid), JSON.stringify([...set].slice(-300))); } catch { /* storage blocked */ } };

export async function render(root, ctx) {
  destroy();
  const mine = gen;
  ensureCss('css/portal.css');
  const tab = TABS.some(([id]) => id === ctx.route.path) ? ctx.route.path : 'dashboard';   // the router maps every hash to the portal
  setNav(tab);
  if (tab !== 'dashboard') {
    const { renderTab } = await import('../portal/tabs.js');
    await renderTab(tab, root, ctx);
    return;
  }
  await renderDashboard(root, ctx, () => mine === gen);
}

async function renderDashboard(root, ctx, current) {
  let d;
  try { d = await getPortal(ctx); }
  catch (e) { root.append(errorState(friendlyError(e), () => location.reload())); return; }
  if (!current()) return;
  const me = d.profile;
  if (!me) { root.append(el('div', { class: 'card' }, emptyState({ icon: 'info', title: 'No employee record linked', text: 'Contact your administrator.' }))); return; }
  const viol = { data: d.violations || [] }, mon = { data: d.monitoring ? [d.monitoring] : [] };
  const pen = { data: d.penalties || [] }, ret = { data: d.retrainings || [] };
  const today = todayISO();
  const mv = monitoringView(mon.data?.[0] ?? null);
  const notices = buildNotices({ violations: viol.data, penalties: pen.data, retrainings: ret.data, monitoring: mon.data?.[0] ?? null, today });
  const uid = ctx.profile.user_id, read = loadRead(uid);

  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: APP.timezone }).format(new Date()));
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const fullName = [me.first_name, me.surname].filter(Boolean).join(' ');
  const initials = `${me.first_name?.[0] ?? ''}${me.surname?.[0] ?? ''}`.toUpperCase();
  const panel = (title, ...kids) => el('section', { class: 'card portal-card', 'aria-label': title }, el('h3', { class: 'portal-card__title' }, title), ...kids);
  const none = (t) => el('p', { class: 'muted' }, t);

  // ---- ID card
  const idHost = el('div', { class: 'portal-id__host' });
  getKeyedLogoUrl().then((logoUrl) => {
    if (!current()) return;                      // navigated away before the logo finished loading
    card = mountIdCard(idHost, { name: fullName, initials, designation: me.designation, company: me.company, status: me.employment_status,
      employeeNo: me.employee_no ?? null, since: me.date_hired ? fmtDate(me.date_hired) : '' }, { logoUrl });
  });

  // ---- monitoring
  let monitoring;
  if (mv.state === 'none') monitoring = none('No active monitoring. Keep up the good work.');
  else if (mv.state === 'cleared') monitoring = el('div', { class: 'stack' }, badge('Monitoring completed', 'green'), none(`Your last monitoring period ended ${fmtDate(mv.end)}.`));
  else {
    const banned = mv.state === 'banned';
    monitoring = el('div', { class: 'stack' },
      el('div', { class: 'row' }, badge(banned ? 'Banned' : `${ordinal(mv.level)} offense`, banned ? 'red' : 'amber'), badge(mv.deployment, banned ? 'red' : mv.holdUntil ? 'amber' : 'green')),
      banned ? el('p', { class: 'muted' }, 'You are not eligible for deployment. Please speak with your supervisor.') : el('div', {},
        el('div', { class: 'bar', role: 'img', 'aria-label': `${mv.pct}% of the monitoring period elapsed` }, el('span', { style: `width:${mv.pct}%` })),
        el('p', { class: 'small muted', style: 'margin-top:6px' }, `Day ${mv.elapsed} of ${mv.total} · ${mv.remaining} day${mv.remaining === 1 ? '' : 's'} remaining · ends ${fmtDate(mv.end)}`)),
      mv.penalty ? el('p', {}, el('strong', {}, 'Applicable penalty: '), mv.penalty) : null,
      mv.pending ? el('p', { class: 'small muted' }, 'A restriction is awaiting supervisor approval and is not in effect yet.') : null);
  }

  // ---- latest QA updates
  const latest = viol.data.slice(0, 3);
  const updates = latest.length ? el('ul', { class: 'list' }, latest.map((v) => el('li', {},
    el('span', {}, el('strong', {}, fmtDate(v.violation_date)), el('div', { class: 'small muted' }, v.category_codes?.join(', ') || 'QA finding')),
    el('span', { class: 'row', style: 'gap:6px;justify-content:flex-end' }, badge(v.severity, SEVERITY_VARIANT[v.severity]), badge(v.status, VIOLATION_STATUS_VARIANT[v.status]))))) : none('No QA violations on record.');

  // ---- active penalties (enforced vs awaiting approval)
  const active = pen.data.filter((p) => p.enforced || p.approval_status === 'proposed');
  const penalties = active.length ? el('ul', { class: 'list' }, active.map((p) => el('li', {},
    el('span', {}, el('strong', {}, `${ordinal(p.offense_no)} offense`), el('div', { class: 'small muted' }, p.penalty + (p.hold_until ? ` · hold until ${fmtDate(p.hold_until)}` : ''))),
    badge(p.enforced ? 'In effect' : 'Awaiting approval', p.enforced ? 'red' : 'amber')))) : none('No active penalties.');

  // ---- retraining notices
  const pend = ret.data.filter((r) => r.result === 'Pending');
  const retraining = pend.length ? el('ul', { class: 'list' }, pend.map((r) => el('li', {},
    el('span', {}, el('strong', {}, r.training), el('div', { class: 'small muted' }, r.retraining_date ? `Scheduled ${fmtDate(r.retraining_date)}` : 'Date to be announced')),
    badge('Pending', RESULT_VARIANT.Pending)))) : none(ret.data.length ? 'No retraining pending.' : 'No retraining assigned.');

  // ---- notification center (derived from your own records; read state is kept on this device)
  const unread = () => notices.filter((n) => !read.has(n.id)).length;
  const countBadge = el('span', { class: 'portal-count' });
  const list = el('div');
  const paintNotices = () => {
    countBadge.textContent = unread() ? String(unread()) : ''; countBadge.hidden = !unread();
    list.replaceChildren(notices.length ? el('ul', { class: 'list' }, notices.slice(0, 8).map((n) => el('li', { class: read.has(n.id) ? 'is-read' : '' },
      el('a', { href: `#/${n.tab}`, onclick: () => { read.add(n.id); saveRead(uid, read); } },
        el('span', { class: `dot dot--${n.tone}`, 'aria-hidden': 'true' }), el('span', {}, el('strong', {}, n.title), el('div', { class: 'small muted' }, n.text))),
      read.has(n.id) ? null : badge('New', 'blue')))) : none('No notifications yet.'));
  };
  paintNotices();
  const notify = el('section', { class: 'card portal-card', 'aria-label': 'Notification center' },
    el('div', { class: 'row', style: 'justify-content:space-between' }, el('h3', { class: 'portal-card__title' }, 'Notifications ', countBadge),
      notices.length ? el('button', { class: 'btn btn--sm', type: 'button', onclick: () => { notices.forEach((n) => read.add(n.id)); saveRead(uid, read); paintNotices(); } }, 'Mark all read') : null), list);

  root.append(syncBanner(d),
    el('header', { class: 'portal-welcome' }, el('span', { class: 'eyebrow' }, 'AHBA Training & QA'), el('h2', {}, `${greet}, ${me.first_name}`),
      el('p', { class: 'muted' }, new Intl.DateTimeFormat('en-PH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: APP.timezone }).format(new Date()))),
    el('div', { class: 'portal-grid' },
      el('section', { class: 'card portal-id', 'aria-label': 'Employee ID' }, idHost, el('p', { class: 'small muted portal-id__hint' }, 'Tap or click the card to flip it.')),
      el('div', { class: 'portal-col' }, panel('Monitoring status', monitoring), notify, panel('Latest QA updates', updates), panel('Active penalties', penalties), panel('Retraining notices', retraining), deviceCard(ctx))));
}
