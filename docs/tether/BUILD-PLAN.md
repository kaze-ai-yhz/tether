# Build plan · Tether v2

Owners: **Alex with CoCo** builds the engine and app. **Dr. Faiz** owns clinical content (his
RUNBOOK.md and SQL, SOAP notes, AI Plan lines, threshold confirmation, call script). One DDL
writer at a time (the `tether-sql` worktree). CoCo **builds on** Faiz's SQL; it never rewrites or
reorders his file. Changes he needs in his file are proposed to him as a diff.

| Time (PT) | Milestone | Done when |
|---|---|---|
| 12:15–12:45 | **M0 Repo and base** | Clone, kit copied in, Faiz's file run as is; `V_RULE_FIRINGS` returns his expected rows for all 14 SYN patients; `10_tether_notes.sql` loads SOAP notes + AI Plan lines |
| 12:45–13:30 | **M1 Pool** | `PATIENT_RULES`, `RULE_EDITS`, `UPDATE_RULE`; `V_P2_FIRINGS`, `V_ALL_FIRINGS`; editing `COPD-3` threshold changes the result; revert |
| 13:30–14:15 | **M2 Plans and queue** | `READ_AI_PLAN` + validator; `COMPOSE_PLAN`/`VALIDATE_PLAN` → `TODOS`; `DRAFT_ACTIONS` fills `ACTION_QUEUE`; app queue with Approve/Edit/Reject through `REVIEW_ACTION` |
| 14:15–15:00 | **M3 Tracking** | `ADVANCE_CLOCK` + `TICK`; `V_MONITORED_VALUES` (Table 2); ladder ENG-1..4 + ENG-DEV; `SIMULATE_CHECKIN_CALL` with handoff; `SEND_APPROVED` → `OUTBOX`; Patients tab and detail |
| 15:00–15:30 | **M4 Governance + stretch** (cut first, in this order: Update P0, P1 learner, Ask) | Role switch shows agent cannot approve; `99_checks.sql` green; `DEMO_RESET` |
| 15:30 | **Freeze** | Record the one-minute video (UI-UX §3) |
| 16:30 | **Submit** | Checklist in COCO-KICKOFF §E |

## Acceptance checks (`sql/99_checks.sql`, each returns PASS/FAIL)

1. 14 SYN patients produce Faiz's expected rule (his test table).
2. Threshold edit changes `V_RULE_FIRINGS`, then revert restores it.
3. `OUTBOX` has no row without an approved or edited draft (red-flag alerts excepted).
4. No draft names a drug or dose (word list from Faiz).
5. SYN-006 never gets an inhaler change; it gets `RECOMMEND_O2_EVAL`.
6. Disallowed custom line → plan REJECTED → Needs clinician.
7. P2 rule cannot loosen P0 (try one, expect rejection).
8. `MODEL_CALLS.input_text` contains no synthetic display name.
9. One open draft per patient per condition.
10. Call handoff: simulated "chest pain" answer creates an urgent clinician alert.

## Demo reset

`scripts/demo_reset.sh`: `snow sql -c hackathon -f sql/care_rules_snowflake.sql`, then `10_…` to
`90_…` in order (Faiz's file recreates his tables; ours are `CREATE IF NOT EXISTS` + `TRUNCATE` +
reseed in `90_demo.sql`). Cached drafts are reloaded from `data/fixtures/` so the demo does not wait
on model calls. Note: Faiz's file calls `GENERATE_DRAFTS()` at the end; that is expected.

## Cuts if late

1. Update P0 → show his `RULES` edit only. 2. P1 learner → mention as next. 3. Ask drawer → drop.
4. App → Snowsight worksheet walkthrough per Faiz's README.
