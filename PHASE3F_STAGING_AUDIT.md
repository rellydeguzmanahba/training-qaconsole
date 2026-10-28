# AHBA Phase 3F — Staging Audit (not production-ready)

Source: latest full repository ZIP + seven files from files (8).zip.

## Integrated in staging (copied, not activated)
- sw.js
- js/pwa/register.js
- js/pwa/offline-store.js
- js/pwa/push-config.js
- js/portal/push.js
- js/portal/chrome.js
- js/portal/data.js

## Critical remaining work
1. No manifest.webmanifest or PWA icon assets in this repository. The service worker precache includes these and installation requires them.
2. js/main.js does not call initPwa; the new portal/data.js and portal/chrome.js are not yet wired into the existing portal.
3. Push VAPID_PUBLIC_KEY is blank; server-side push delivery and relevant database functions/migrations must be reviewed.
4. SQL migrations 010a/010b/011 and RLS must be verified in a separate development Supabase project before enabling technician accounts.
5. Offline access to sensitive personnel records requires security review, particularly shared-device behavior.
6. Browser runtime, deployment and actual authentication tests have not been performed.

## Static relative import audit
No missing relative JS imports detected.
