import { sb } from '../supabase.js';
import * as store from './offline-store.js';
import { unsubscribeLocal } from '../portal/push.js';

let deferred = null, authBound = false;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; document.dispatchEvent(new Event('ahba:installable')); });
window.addEventListener('appinstalled', () => { deferred = null; });
export const canPromptInstall = () => !!deferred;
export async function promptInstall() {
  if (!deferred) return false;
  deferred.prompt();
  const r = await deferred.userChoice; deferred = null;
  return r.outcome === 'accepted';
}

const ensureHead = (tag, attrs) => {
  const key = Object.entries(attrs)[0];
  if (document.head.querySelector(`${tag}[${key[0]}="${key[1]}"]`)) return;
  const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); document.head.append(n);
};

// Called for every signed-in session. Cleanup is for everyone; install + service worker only for technicians.
export function initPwa(role) {
  if (!authBound) {                                                  // does not touch the sign-in logic: it only listens
    authBound = true;
    sb.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') { store.clearAllData(); unsubscribeLocal(); }          // no personal data survives sign-out
      else if (session?.user) store.purgeOthers(session.user.id);                        // a different account never sees another's cache
    });
  }
  if (role !== 'technician') return;
  ensureHead('link', { rel: 'manifest', href: 'manifest.webmanifest' });
  ensureHead('link', { rel: 'apple-touch-icon', href: 'assets/icons/apple-touch-icon.png' });
  ensureHead('meta', { name: 'theme-color', content: '#0f7a52' });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker not registered', e));
}
