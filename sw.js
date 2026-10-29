// AHBA Training & QA service worker.
// Caches ONLY static app files (no personal data): the shell, scripts, styles, icons and the pinned Supabase library.
// Supabase API / storage responses are never cached here. Offline personal data lives in IndexedDB (js/pwa/offline-store.js),
// is limited to the signed-in technician, and is wiped on sign-out or account change.
const VERSION = 'v15-policy-catalog';                       // bump to force clients to refresh the shell
const SHELL = `ahba-shell-${VERSION}`, RUNTIME = `ahba-runtime-${VERSION}`, CDN = `ahba-cdn-${VERSION}`;
const CDN_ALLOW = ['https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.1/dist/umd/supabase.js'];   // pinned = immutable
const PRECACHE = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
  "assets/icons/apple-touch-icon.png",
  "css/base.css",
  "css/login.css",
  "assets/images/ahba-training-qa-logo.webp",
  "css/components.css",
  "css/dashboard.css",
  "css/employees.css",
  "css/layout.css",
  "css/portal.css",
  "css/command-center.css",
  "css/theme.css",
  "js/ui/a11y.js",
  "js/ui/auth-screens.js",
  "js/ui/badge.js",
  "js/ui/brand.js",
  "js/ui/charts.js",
  "js/ui/dialog.js",
  "js/ui/form.js",
  "js/ui/hero3d.js",
  "js/ui/icons.js",
  "js/ui/id-card3d.js",
  "js/ui/sidebar.js",
  "js/ui/states.js",
  "js/ui/table.js",
  "js/ui/toast.js",
  "js/utils/csv.js",
  "js/utils/dates.js",
  "js/utils/db.js",
  "js/utils/dom.js",
  "js/utils/errors.js",
  "js/utils/metrics.js",
  "js/utils/privacy.js",
  "js/utils/schema.js",
  "js/utils/styles.js",
  "js/utils/submit.js",
  "js/utils/validate.js",
  "js/portal/model.js",
  "js/portal/chrome.js",
  "js/portal/data.js",
  "js/portal/push.js",
  "js/pwa/register.js",
  "js/pwa/offline-store.js",
  "js/pwa/push-config.js",
  "js/portal/monitoring-tab.js",
  "js/portal/penalties-tab.js",
  "js/portal/tabs.js",
  "js/portal/training-tab.js",
  "js/portal/attendance.js",
  "js/modules/training-attendance.js",
  "js/vendor/qrcode.min.js",
  "js/modules/attendance.js",
  "js/portal/violations-tab.js",
  "js/app.js",
  "js/main.js",
  "js/auth.js",
  "js/config.js",
  "js/supabase.js",
  "js/router.js",
  "js/routes.js",
  "js/permissions.js",
  "js/modules/portal.js",
  "js/modules/evidence.js"
];

// Decide how a request is handled. Pure function (unit-tested).
function classify(req, origin) {
  if (req.method !== 'GET') return 'skip';
  const url = new URL(req.url);
  if (url.hostname.endsWith('.supabase.co') || url.hostname.endsWith('.supabase.in')) return 'skip';   // never cache API/storage
  if (req.headers && req.headers.has && req.headers.has('authorization')) return 'skip';
  if (url.origin === origin) {
    if (!url.pathname.startsWith(new URL(self.registration.scope).pathname)) return 'skip';
    if (url.pathname.endsWith('/sw.js')) return 'skip';
    // Cache only known static assets, not arbitrary same-origin endpoints.
    if (req.mode !== 'navigate' && !/\.(?:js|css|png|webp|jpg|jpeg|svg|ico|webmanifest)$/i.test(url.pathname)) return 'skip';
    return req.mode === 'navigate' ? 'navigate' : 'static';
  }
  return CDN_ALLOW.includes(url.href) ? 'cdn' : 'skip';
}

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await Promise.allSettled(PRECACHE.map((u) => c.add(u)));        // one missing file must not break installation
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keep = new Set([SHELL, RUNTIME, CDN]);
    for (const k of await caches.keys()) if (k.startsWith('ahba-') && !keep.has(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

const putIfOk = async (cacheName, req, res) => { if (res && (res.ok || res.type === 'opaque')) (await caches.open(cacheName)).put(req, res.clone()); return res; };

self.addEventListener('fetch', (e) => {
  const how = classify(e.request, self.location.origin);
  if (how === 'skip') return;
  if (how === 'navigate') {
    e.respondWith(fetch(e.request).then((r) => putIfOk(SHELL, 'index.html', r)).catch(async () => (await caches.match('index.html')) || (await caches.match('./')) || Response.error()));
  } else if (how === 'cdn') {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => putIfOk(CDN, e.request, r))));
  } else {                                                          // static: network-first so new deployments appear promptly
    e.respondWith(fetch(e.request).then((r) => putIfOk(RUNTIME, e.request, r))
      .catch(async () => (await caches.match(e.request)) || Response.error()));
  }
});

// Push: payloads are generic by design (no violation details on a lock screen).
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { /* ignore malformed payload */ }
  e.waitUntil(self.registration.showNotification(String(d.title || 'AHBA Training & QA').slice(0, 80), {
    body: String(d.body || 'You have a new update in your portal.').slice(0, 140),
    icon: 'assets/icons/icon-192.png', tag: String(d.tag || 'ahba-update').slice(0, 60), data: { url: './#/dashboard' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if ('focus' in c) { if ('navigate' in c) c.navigate(url).catch(() => {}); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
