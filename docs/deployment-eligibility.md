# Deployment eligibility: current calculation (no rule was changed)

Source: `supabase/migrations/004_offense_engine.sql`, view `v_offense_status`.

```
deployment_eligible = not banned
                      and no approved, still-running hold   (hold_until >= today)
                      and employment_status not in ('Resigned', 'Terminated')
```

- **Banned**: an *approved* ban that has not been lifted (offense level = highest level in `penalty_rules`).
- **Hold**: an *approved* offense action with `hold_until` in the future. A *proposed* hold or ban restricts nothing until a supervisor or admin approves it; the technician shows "Restriction pending approval" and is flagged for review.
- **Training is not an input.** A technician with missing required training is still "Deployable". This mirrors the original workbook's *Deployment Status* (BANNED / ON HOLD / Deployable), which was driven only by offense monitoring.
- Dashboard "Deployable" counts active staff (Probationary + Regular) with `deployment_eligible = true`.

## Decision needed from the business
| Option | Effect | Change required |
|---|---|---|
| A. Keep (current) | Training gaps are reported, never blocking | none |
| B. Training gate | Deployable only if all required training is complete | add training to `v_offense_status` (new migration) |
| C. Two flags | Keep "Deployable" and add a separate "Training ready" flag shown everywhere | UI + view column, no change to existing flag |

Phase 3A shows both measures side by side on the dashboard (Deployment readiness) so the gap is visible. No migration was written for B or C.
