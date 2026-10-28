# AHBA Phase 3F integration — development build

## Implemented
- PWA manifest, install icons, service worker, static shell caching, technician-only registration.
- Technician dashboard and all three secondary tabs use one data entry point with network-error fallback to an account-keyed IndexedDB snapshot.
- Last-synced indicator and device installation controls.
- Derived in-app notices from personal QA records remain available in the dashboard.
- Sign-out clears locally stored snapshots; switching accounts purges other accounts.
- No API or Supabase storage responses are cached by the service worker.

## NOT completed / not safe to enable in production yet
1. Web Push: VAPID_PUBLIC_KEY is intentionally blank; backend migration 012, subscription functions, sender and scheduled delivery are not provided or verified. Push controls stay hidden. New notifications require connectivity.
2. Offline cold-start: authentication profile retrieval still requires Supabase connectivity; the cached technician snapshot works for navigation/fetch failures only after an authenticated session has been initialized. Do not advertise fully offline sign-in.
3. Cached technician records are not encrypted at rest. Only use on trusted personal devices after a privacy review; shared devices should not use this feature without additional protection.
4. Migrations 010a, 010b, 011 were NOT executed. Verify them on a separate Supabase development project first, including RLS and account linkage.
5. No end-to-end browser, real-account, mobile-device, Supabase, or push-delivery testing was possible here.

## Deployment checklist
1. Work on a non-production Git branch, with a separate Supabase development project.
2. Verify migration prerequisites, profile linkage, and technician role; do not apply setup_all.sql to an existing production database.
3. Serve locally with HTTP (not file://), use test accounts, and inspect browser Console and Network.
4. Check technician dashboard and four tabs online; disconnect network and navigate tabs; reconnect and refresh.
5. Test logout, switching users, offline privacy, install on Android/iOS, cache updates, and reduced-motion behavior.
6. Only merge after independent security review and Phase 3G testing.
