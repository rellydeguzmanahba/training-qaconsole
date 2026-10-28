# Employee quick-view implementation

- Open **Technicians**. Hover over a technician name to see an employee summary card.
- Keyboard: tab to the name to show preview, Escape to close, Enter for full profile.
- Touch: tap name once for preview, tap again for full profile.
- Preview shows company, designation, employment status, training, deployment, hire date, and mobile from existing authorized directory data.
- No new Supabase queries, migrations, or role permissions.
- Updated service-worker cache version to refresh the UI.
- Only the **Technicians** directory gets hover preview in this build; other tabs are not redesigned.
- Test with an authorized admin and verify no sensitive data is exposed to unauthorized roles.
