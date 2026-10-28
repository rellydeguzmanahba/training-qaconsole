# AHBA Command Center — Visual Redesign

This update uses the exact repository provided October 28, 2026. It makes **visible changes** to the authenticated Admin Console: dark forest-green sidebar, gold-highlighted navigation, new header, emerald hero, larger metric tiles, responsive panels, and refreshed typography. It preserves the finalized login page, existing Supabase queries, routes, roles, technician portal, and SQL files.

## Changed files
- `css/command-center.css` — new visual design, scoped to `#app`; no remote fonts or external assets.
- `js/ui/sidebar.js` — loads the new CSS after the existing design system.

## Before deploying
- Back up your current `main` branch, preferably test this on a development branch.
- The new look appears **after logging in**; the login page intentionally stays unchanged.
- Test admin navigation, tables, modal dialogs, mobile menu, and the Technician Portal.
- This is a frontend visual redesign, **not** verification of Supabase migrations, RLS or push notification delivery.
- If a previous service worker serves old assets, unregister it from browser developer tools and reload; don't delete app data without considering offline cache needs.
