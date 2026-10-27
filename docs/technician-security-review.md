# Technician role: security review (Phase 3C)

Migrations: `010a_technician_role_enum.sql` (run alone first) then `010b_technician_security.sql`. Test: `supabase/tests/technician_rls_test.sql` (rolls back). **Nothing here is executed automatically.**

## How isolation works
1. `is_active_user()` now means *active staff* (role <> technician). Every existing policy, storage policy and `security_invoker` view uses it, so a technician is denied by default everywhere.
2. Technicians read only through whitelisted views/functions that find the technician from `auth.uid()` via `my_technician_id()`. No id from the browser is trusted.
3. `my_technician_id()` returns null (portal empty) if the account is inactive, unlinked, or the employee is Resigned/Terminated.
4. Links live in `technician_accounts` (`user_id` PK, `technician_id` UNIQUE): one account <-> one technician. Only admin RPCs write it; the account must be a verified viewer/technician account; staff accounts cannot be linked; email is shown for the admin to check, never used to auto-match.

## Exposure review
| Object | Technician access | Why |
|---|---|---|
| technicians, training_records, violations, retrainings, offense_actions, violation_*, technician_access, lookups, settings, import_*, audit_log | none | policies require staff / admin roles |
| profiles | own row only | existing policy `user_id = auth.uid()` |
| technician_accounts | none | admin-only select, no client writes |
| v_offense_status, v_offense_history, offense_chain() | empty result | invoker security: underlying RLS applies |
| create_violation, update_violation | denied | invoker + RLS (admin/qa) |
| save_retraining, recalculate_offenses, lift_ban, admin_*, link/unlink | denied | explicit role checks inside |
| v_my_profile, v_my_violations, v_my_evidence, v_my_retrainings, my_monitoring(), my_penalties() | own records, whitelisted columns | filtered by `my_technician_id()` |
| storage `evidence` | only files QA flagged `visible_to_technician` on own violations | `technician_can_read_object()` |

Deliberately **not** exposed: QA remarks, recommendations, reporter names, IBAS/JO numbers, decision notes, review flags, "next offense" previews, audit and auth ids, birthdate, contact details.

## Behaviours to confirm
- Rejected penalties are hidden; proposed (pending) ones are shown as "awaiting approval", approved ones as enforced or lifted.
- Evidence is private by default; QA/admin must share each item (UI toggle comes with the technician tabs).
- Unlinking deactivates the account (role viewer, inactive) rather than deleting it.
- Until the portal ships (3D), a linked technician who signs in sees a placeholder page and no data.

## Run order
1. Review both SQL files. 2. Run `010a` alone. 3. Run `010b`. 4. Run the test script: expect the last row "ALL TECHNICIAN RLS TESTS PASSED". 5. Deploy the front-end files. 6. Settings -> Technician accounts to link accounts.

## Open decisions (needed in 3D)
- Employee number for the ID card (no such column exists; `technicians.id` is internal and is not shown). Add `employee_no`?
- Employee photo: no storage/column yet.
- Training vs deployment (Option A/B/C in `deployment-eligibility.md`): portal currently mirrors the existing rule (offense policy only).
