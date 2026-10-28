import { el } from '../utils/dom.js';
import { badge, RESULT_VARIANT } from '../ui/badge.js';
import { emptyState, errorState } from '../ui/states.js';
import { friendlyError } from '../utils/errors.js';
import { fmtDate } from '../utils/dates.js';
import { ordinal } from '../portal/model.js';
import { getPortal } from './data.js';
import { syncBanner } from './chrome.js';

// Penalties: pending (awaiting supervisor approval) is always shown apart from enforced penalties.
export async function renderPenalties(root, ctx) {
  let d;
  try { d = await getPortal(ctx); }
  catch (e) { root.append(errorState(friendlyError(e), () => location.reload())); return; }
  root.append(syncBanner(d));
  const pen = { data: d.penalties || [] }, ret = { data: d.retrainings || [] };
  const inEffect = pen.data.filter((p) => p.enforced), pending = pen.data.filter((p) => p.approval_status === 'proposed');
  const history = pen.data.filter((p) => !p.enforced && p.approval_status !== 'proposed');
  const needRetraining = ret.data.filter((r) => r.result !== 'Passed');

  const card = (p, kind) => el('article', { class: `card pen pen--${kind}` },
    el('div', { class: 'row', style: 'justify-content:space-between' }, el('strong', {}, `${ordinal(p.offense_no)} offense`),
      kind === 'effect' ? badge('In effect', 'red') : kind === 'pending' ? badge('Awaiting approval', 'amber') : p.lifted ? badge('Lifted', 'green') : p.approval_status === 'approved' ? badge('Completed', 'green') : badge('Recorded')),
    el('p', {}, p.penalty),
    el('div', { class: 'small muted' }, `Offense date ${fmtDate(p.offense_date)}${p.hold_days > 0 ? ` · hold ${p.hold_days} day${p.hold_days === 1 ? '' : 's'}${p.hold_until ? ` until ${fmtDate(p.hold_until)}` : ''}` : ''} · ${p.severity_group} severity`),
    kind === 'pending' ? el('p', { class: 'small muted' }, 'This restriction is not in effect until a supervisor approves it.') : null,
    p.violation_id ? el('a', { class: 'small', href: `#/violations/${p.violation_id}` }, 'View the related violation') : null);
  const group = (title, items, kind, none) => el('section', { class: 'stack', 'aria-label': title }, el('h3', { class: 'portal-card__title' }, `${title} (${items.length})`),
    items.length ? el('div', { class: 'pen-list' }, items.map((p) => card(p, kind))) : el('p', { class: 'muted' }, none));

  root.append(el('header', { class: 'portal-welcome' }, el('h2', {}, 'Penalties'), el('p', { class: 'muted' }, 'Restrictions are enforced only after approval.')),
    needRetraining.length ? el('section', { class: 'card portal-card', 'aria-label': 'Retraining required' }, el('h3', { class: 'portal-card__title' }, 'Retraining requirements'),
      el('ul', { class: 'list' }, needRetraining.map((r) => el('li', {}, el('span', {}, el('strong', {}, r.training),
        el('div', { class: 'small muted' }, r.result === 'Failed' ? 'Not passed. Another attempt will be assigned.' : r.retraining_date ? `Scheduled ${fmtDate(r.retraining_date)}` : 'Date to be announced')), badge(r.result, RESULT_VARIANT[r.result]))))) : null,
    pen.data.length || ret.data.length ? el('div', { class: 'stack' }, group('In effect', inEffect, 'effect', 'No penalties are in effect.'),
      group('Awaiting approval', pending, 'pending', 'Nothing is waiting for approval.'), group('History', history, 'history', 'No earlier penalties.'))
      : el('div', { class: 'card' }, emptyState({ icon: 'check', title: 'No penalties', text: 'There are no penalties on your record.' })));
}
