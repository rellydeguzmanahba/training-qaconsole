# AHBA QA & Training Management System

Internal web app (HTML + CSS + vanilla JS modules) on Supabase (PostgreSQL, Auth, Storage) and GitHub Pages. Free tier only. No build step, no backend server.

## 1. One-time setup

### Supabase
1. Open your project → **SQL Editor** → run `supabase/setup_all.sql` (or the files in `supabase/migrations/` in this order: `001, 002, 005, 003, 004, 006, 007`).
2. **Authentication → Sign In / Providers → Email**: turn **off** "Allow new users to sign up". Keep email + password on. Set the minimum password length to 12 or more.
3. **Authentication → URL Configuration**: set **Site URL** to your GitHub Pages address.
4. **Authentication → Users → Add user**: create yourself (email + password, tick auto-confirm).
5. Make yourself admin (SQL editor):
   ```sql
   update public.profiles set role = 'admin', active = true
    where user_id = (select id from auth.users where email = 'YOUR_EMAIL');
   ```
6. Run `supabase/checks/verify_security.sql` and confirm every "EXPECT" holds.

### GitHub Pages
1. Create a **new repository**. (Free GitHub Pages needs a public repo; the repo holds code only, never data or secrets.)
2. Upload the contents of this folder (`index.html`, `css/`, `js/`, `supabase/`, `.nojekyll`, `.gitignore`, `README.md`). **Do not upload the Excel workbook.**
3. Repo → **Settings → Pages** → Source: *Deploy from a branch* → `main` / `/ (root)`.
4. Open the Pages URL and sign in.

`js/config.js` already holds your project URL and publishable key. Both are public by design; the database rules protect the data. Never put a service-role or secret key in this repo.

### Adding users later
Supabase → Authentication → Users → Add user, then in the app: **Settings → Users** → set the role and tick Active. New accounts stay inactive (no data access) until you do.

## 2. Roles

| Role | Can read | Can change |
|---|---|---|
| Admin | everything | everything, settings, users, import |
| QA | everything | technicians, violations, evidence |
| Trainer | everything | technicians, training, retraining |
| Supervisor | everything | approve/reject holds and bans, lift bans |
| Viewer | everything | nothing |

The audit log is visible to Admin, QA and Supervisor. All of this is enforced by the database (row level security and triggers); the interface only hides buttons.

## 3. First data load
Sign in as admin → **Excel Import** → choose the workbook → review the preview and issue list → Import. Fix flagged items in the workbook (or the app) and re-run: existing records are skipped, never overwritten.

## 4. Acceptance test script (about 20 minutes)

Use three test accounts: admin, qa, viewer (add trainer and supervisor if you can).

| # | As | Do | Expect |
|---|---|---|---|
| 1 | any | open the site signed out | only the login screen; no data |
| 2 | new user | sign in before activation | "Account not active" screen |
| 3 | admin | Settings → Users → activate and assign role | user can sign in |
| 4 | admin | Excel Import → analyze → import | counts match the preview; re-import adds 0 |
| 5 | qa | add a technician twice with the same name | second is refused as duplicate |
| 6 | two tabs | edit the same technician in both, save both | second save says "changed by someone else" |
| 7 | trainer | Training → Record training for 3 technicians, repeat | repeat is skipped as already recorded |
| 8 | qa | Record violation with categories; upload a PDF; open it | file opens via a temporary link |
| 9 | qa | record violations for one technician to reach a hold level (3rd offense within the monitoring period) | an approval request appears; technician is still Deployable |
| 10 | supervisor | Offense Monitoring → Approvals → Approve | technician becomes ON HOLD |
| 11 | viewer | open every page | everything readable; no Add/Edit/Approve buttons |
| 12 | viewer | type `#/settings` and `#/import` into the address bar | "Access restricted" (and the database would refuse the data anyway) |
| 13 | trainer | assign retraining to a violation, mark Passed | violation becomes Closed |
| 14 | admin | Reports → each report → Download CSV | files open in Excel with correct dates and names |
| 15 | admin | Settings → change a penalty rule | pending proposals recalculate |
| 16 | admin | stay idle 60 minutes | automatic sign-out |

Step 12 is a negative test: hiding a page is only convenience; the database refuses writes from a Viewer even if someone crafts a request by hand.

## 5. Free-tier facts to plan around
- **Inactivity pause:** free projects pause after about 7 days without activity. Sign in at least weekly, or restore from the dashboard.
- **No automatic backups on the free plan.** Export regularly: run the Reports CSV exports, and from the dashboard use Database → Backups if available, or `pg_dump` from a computer with the connection string. Keep exports private; they contain personal data.
- **Limits:** 500 MB database, 1 GB file storage (evidence is capped at 10 MB per file), 50,000 monthly active users. Your data is far below these.
- **Row cap:** the API returns 1,000 rows per request; the app pages through automatically.

## 6. Security notes
- Row level security is enabled on every table; the anonymous role has no access. Roles are checked in the database, not just the interface.
- Role changes are admin-only, and the last admin cannot be removed or demoted.
- Evidence is in a private bucket and opened through short-lived signed links.
- All important changes are written to an append-only audit log.
- The page sets a strict content-security policy (own files, the Supabase library from jsDelivr, SheetJS on the import page only, your Supabase project). Optional extra hardening: add Subresource Integrity to the two CDN `<script>` tags (`openssl dgst -sha384 -binary FILE | openssl base64 -A`).
- Sessions end after 60 minutes idle (`idleMinutes` in `js/config.js`).
- GitHub Pages cannot send security headers, so the app refuses to run inside a frame (clickjacking defence).

## 7. Troubleshooting
- **Blank page / "could not start":** a content blocker or network is blocking `cdn.jsdelivr.net`, or `js/config.js` is wrong. Open the browser console.
- **Sign-in works but pages say "permission denied":** the account is inactive or has the wrong role (Settings → Users).
- **Seed or migration fails with an RLS error:** run `002_rls.sql` before `005_seed_lookups.sql`.
- **"Spreadsheet library did not load" on import:** adjust the SheetJS version in `js/import/sheetjs.js`.
- **Numbers look wrong:** there are no stored totals. Everything is recalculated live, so check the underlying records.
