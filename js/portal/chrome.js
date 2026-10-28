import { el } from '../utils/dom.js';
import { icon } from '../ui/icons.js';
import { fmtDateTime } from '../utils/dates.js';
import { friendlyError } from '../utils/errors.js';
import { canPromptInstall, promptInstall } from '../pwa/register.js';
import { pushConfigured, pushSupport, currentSubscription, enablePush, disablePush } from './push.js';
import { resetPortalCache } from './data.js';

const refresh = () => { resetPortalCache(); window.dispatchEvent(new Event('hashchange')); };      // the router re-renders the current tab

// Always visible: tells the technician whether they are looking at live or saved (possibly stale) information.
export function syncBanner(d) {
  const when = fmtDateTime(d.syncedAt);
  if (d.source === 'cache') {
    return el('div', { class: 'sync sync--offline', role: 'status' }, icon('alert', 18),
      el('span', {}, 'You are offline. Showing information last updated ', el('strong', {}, when), '. It may be out of date.'),
      el('button', { class: 'btn btn--sm', type: 'button', onclick: refresh }, 'Try again'));
  }
  return el('div', { class: 'sync' }, el('span', { class: 'small muted' }, `Last updated ${when}`),
    el('button', { class: 'btn btn--sm btn--ghost', type: 'button', onclick: refresh, 'aria-label': 'Refresh now' }, 'Refresh'));
}

// Install + push controls. Push is hidden until a VAPID public key is configured (js/pwa/push-config.js).
export function deviceCard(ctx) {
  const body = el('div', { class: 'stack' });
  const card = el('section', { class: 'card portal-card', 'aria-label': 'This device' }, el('h3', { class: 'portal-card__title' }, 'This device'), body);
  const note = (t) => el('p', { class: 'small muted' }, t);

  async function paint() {
    const s = pushSupport(), rows = [];
    if (matchMedia('(display-mode: standalone)').matches || navigator.standalone) rows.push(note('Installed on this device.'));
    else if (canPromptInstall()) rows.push(el('div', { class: 'row' }, el('button', { class: 'btn btn--primary btn--sm', type: 'button', onclick: async () => { await promptInstall(); paint(); } }, 'Install app'), note('Opens like an app and works offline.')));
    else if (s.ios) rows.push(note('To install on iPhone or iPad: tap Share, then “Add to Home Screen”.'));
    else rows.push(note('You can install this app from your browser menu.'));

    if (pushConfigured()) {
      if (!s.supported) rows.push(note('This browser does not support push notifications.'));
      else if (s.needsInstall) rows.push(note('To receive notifications on iPhone, first add this app to your Home Screen, then open it from there.'));
      else if (s.permission === 'denied') rows.push(note('Notifications are blocked for this site in your browser settings.'));
      else {
        const sub = await currentSubscription();
        const act = async (fn, ok) => { try { await fn(ctx.sb); ctx.toast(ok, 'success'); } catch (e) { ctx.toast(e?.message && !e.code ? e.message : friendlyError(e), 'error'); } paint(); };
        rows.push(sub
          ? el('div', { class: 'row' }, el('span', { class: 'badge badge--green' }, 'Notifications on'), el('button', { class: 'btn btn--sm', type: 'button', onclick: () => act(disablePush, 'Notifications turned off.') }, 'Turn off'))
          : el('div', { class: 'row' }, el('button', { class: 'btn btn--sm btn--primary', type: 'button', onclick: () => act(enablePush, 'Notifications turned on.') }, 'Turn on notifications')),
          note('Alerts never include violation details. Delivery needs an internet connection; if your phone is offline, it arrives when it reconnects (not guaranteed).'));
      }
    }
    body.replaceChildren(...rows);
  }
  paint();
  document.addEventListener('ahba:installable', paint, { once: true });
  return card;
}
