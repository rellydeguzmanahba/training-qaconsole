import { VAPID_PUBLIC_KEY } from '../pwa/push-config.js';

export const pushConfigured = () => !!VAPID_PUBLIC_KEY;
export function pushSupport() {
  const ua = navigator.userAgent;
  const ios = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  return { supported, ios, standalone, needsInstall: ios && !standalone, permission: 'Notification' in window ? Notification.permission : 'unsupported' };
}
const b64 = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4), r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...r].map((c) => c.charCodeAt(0))); };
const ready = () => Promise.race([navigator.serviceWorker.ready, new Promise((_, rej) => setTimeout(() => rej(new Error('The app is not ready for notifications yet. Reload and try again.')), 6000))]);

export async function currentSubscription() { try { return await (await ready()).pushManager.getSubscription(); } catch { return null; } }
// Must be called from a user gesture (button click): required by browsers and by iOS.
export async function enablePush(sb) {
  if (Notification.permission !== 'granted' && (await Notification.requestPermission()) !== 'granted') throw new Error('Notifications were not allowed on this device.');
  const reg = await ready();
  const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(VAPID_PUBLIC_KEY) });
  const j = sub.toJSON();
  const { error } = await sb.rpc('save_push_subscription', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_ua: navigator.userAgent.slice(0, 200) });
  if (error) throw error;
}
export async function disablePush(sb) {
  const sub = await currentSubscription();
  if (!sub) return;
  await sb.rpc('delete_push_subscription', { p_endpoint: sub.endpoint });
  await sub.unsubscribe();
}
export async function unsubscribeLocal() {                           // on sign-out: stop this device receiving; the server row is removed on the next failed send
  try { const reg = await navigator.serviceWorker?.getRegistration(); await (await reg?.pushManager.getSubscription())?.unsubscribe(); } catch { /* ignore */ }
}
