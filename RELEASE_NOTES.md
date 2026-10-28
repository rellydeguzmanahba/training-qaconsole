# AHBA Training & QA Console — Phase 3 release candidate

This archive is a **release candidate for a GitHub Desktop development branch**, not a certified production release. It has not been tested against your live Supabase project or with real accounts.

## Included
- Existing admin modules, finalized login, technician portal, animated ID, four portal sections.
- PWA assets, install support, service worker, account-scoped IndexedDB snapshots, offline fallback after an authenticated session.
- Additional automated static checks (`scripts/check-release.mjs`).
- Corrected SQL test harness recursion; **the SQL tests have NOT been run on Supabase**.

## Known limitations / release gates
1. Technician portal requires migrations `010a`, `010b`, `011`, in order, after reviewing your actual schema and backing up. **Do not execute `setup_all.sql` on an existing database.**
2. Push notifications are **disabled**: no VAPID keys, subscription table, delivery backend, or migration 012 is included. In-app notices are not push notifications.
3. Offline snapshot is unencrypted in IndexedDB and should only be used on trusted personal devices. Cold-start sign-in offline is unsupported. Offline cached data can be stale; revocations cannot be verified until reconnecting.
4. The application still needs real browser smoke tests, Supabase RLS tests, and admin/technician end-to-end tests before merging to `main`.
5. GitHub Pages is a static host. Backend push delivery requires a separate trusted server-side component.

## GitHub Desktop deployment sequence
1. Back up your current production repository and Supabase schema/data.
2. In GitHub Desktop create branch `phase-3-development` from your known-good `main`.
3. Copy the contents of this archive **into the repository root** (where `index.html` belongs), not into a nested folder. Do not copy `.git` from elsewhere.
4. Review changes; commit and push **only the development branch**.
5. Test locally with an HTTP server (`python -m http.server 8000` from repo root) or publish a separate GitHub Pages test environment; do not merge to `main` yet.
6. In Supabase **development** project, verify existing migration history, then apply required migrations individually and run `supabase/tests/technician_rls_test.sql` in a transaction. Resolve all failures before production.
7. Verify: admin login and every existing module; technician account linking; own-record isolation with two distinct test users; deactivate/unlink access; sign-out/cache clearing; mobile layout; install/offline/reconnect; browser console and network 404s.
8. Only after all checks pass and a rollback plan is ready, merge into `main`.

## Run static checks
From repository root: `node scripts/check-release.mjs`.
