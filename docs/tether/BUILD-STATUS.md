# Tether build status (live, updated at each milestone push)

Last update: Fri Oct 23, 2026, 14:20 PT (M0 done). Freeze 15:30, submit 16:30.
Faiz's `README.md`, `docs/RUNBOOK.md` and `sql/care_rules_snowflake.sql` stay the source of truth; Tether never edits them.

## Faiz's base, adopted as is (commit 60fe5f1)

Faiz's SQL now holds the SOAP notes (`CLINICAL_NOTES`, 45 notes), the signed AI Plan block and its parser
(`OVERRIDE_KEYS`, `SAFETY_LOCKED_TERMS`, `V_PATIENT_OVERRIDES`, `V_ACTIVE_OVERRIDES`), individualized goals, HOLD,
the human-call swap (`ENG-3H`) and `PLAN-REVIEW` items. Tether builds on these objects and does not duplicate them.
The RUNBOOK test table (15 patients) is the expected result Tether checks against.

## What Tether adds on top (new files `sql/10_…`–`99_…` and `app/web/`)

| Piece | What it does | State |
|---|---|---|
| Runner | `scripts/run_sql.sh` runs Faiz's file unchanged, then Tether files in order | Done (M0) |
| Claude reads the AI Plan | Plain-language reading of each signed AI Plan block (only that text and the SYN id go to Claude); code still decides what applies | Not started |
| Todos (Table 1) and monitored values (Table 2) | Per patient: what is collected, when, from which rule or AI Plan line; days overdue and ladder rung | Not started |
| Drafts | Claude drafts every non-held firing into `ACTION_QUEUE` with the patient's preferences (language, contact window); fixed text for red flags and PLAN-REVIEW; drug and dose check on every draft; every model input logged in `MODEL_CALLS` | Not started |
| Approval queue app | Next.js on localhost:3000: queue, patients, patient detail, rules; nothing is sent without a clinician click | Shell + queue done; patients, rules in progress |
| Simulated clock and calls | `ADVANCE_CLOCK(days)` moves `AS_OF`; simulated AI check-in call (answered, no answer, chest pain handoff); sends go to `OUTBOX` (simulated) | Not started |
| Threshold edit | `UPDATE_RULE` with reason and audit; shows which patients' results change | Not started |
| Governance | Real roles: `CARE_AGENT_ROLE` can draft but not approve; `CLINICIAN_ROLE` approves; `RUN_CHECKS()` | Not started |
| Stretch | Ask drawer (Cortex Agent over a semantic view) | Not started |
| Cut | P1 doctor-rule learner, Update P0 guideline ingest, Cortex Search | Not built |

Expected statuses at the start of the demo: Needs clinician SYN-005, 006, 009, 010, 011, 012, 013; Awaiting approval
SYN-001, 003, 004, 007, 014; Pending SYN-008 (escalation held until 2026-11-15 by the clinician); Ongoing follow-up
SYN-002, 015.

## Verified in the lab account

- **M0 (14:16):** Faiz's SQL runs unchanged; live `V_RULE_FIRINGS` matches his RUNBOOK test table for all 15
  patients (15/15 PASS). `V_PATIENT_OVERRIDES`: 26 applied, 1 held for confirmation (SYN-010 A1C goal 9.5%),
  1 blocked (SYN-005 red-flag line), 0 unrecognized. His `GENERATE_DRAFTS` stops with "Use of session variable
  '$CLAUDE_MODEL' is not allowed in owners rights stored procedure"; Tether drafts with its own procedure and the fix is
  proposed in `docs/tether/PROPOSED-CHANGES.md`.
- `ATTENDEE_ROLE` can create the database and roles; `CARE_AGENT_ROLE` and `CLINICIAN_ROLE` exist.
- Claude through Cortex `AI_COMPLETE`: `claude-opus-5-5`, `claude-sonnet-5-5` and `claude-sonnet-4-5` all answer.
  Structured JSON output works only on `claude-sonnet-4-5` (Faiz's default); `model_parameters` works on
  `claude-opus-5-5` and `claude-sonnet-4-5`, not on `claude-sonnet-5-5`.
- Cross-region inference is enabled.

## How you can help now (no code needed)

Keep SYN-001…015 as they are: they are Faiz's test table. New material goes in new files that run after his.

1. **Drug and dose word list** (Faiz), used to check every Claude draft: `sql/16_safety_terms_faiz.sql` with rows
   `INSERT INTO CARE_RULES.CORE.SAFETY_TERMS (term, kind, source) VALUES ('<drug name>', 'DRUG_NAME', 'Faiz');`
   (kinds `DRUG_CLASS`, `DRUG_NAME`, `DOSE_UNIT`; `mg/dL` is a glucose unit, not a dose).
2. **AI check-in call script** (Faiz, approved once per the runbook): plain text in `docs/tether/CALL-SCRIPT.md`.
3. **COPD-RED**: the resting SpO2 red-flag value and how the patient baseline is stored (proposal in
   `docs/tether/PROPOSED-CHANGES.md` once pushed).
4. **Extra synthetic patients** (anyone): new ids from `SYN-016`, with a diagnosis, medications by class, readings,
   optional note with an AI Plan block, and the expected result in one sentence, in `sql/17_extra_patients.sql`.
5. **One-minute video script** (UI-UX.md §3) and the submission text (name + one line, problem and impact,
   Snowflake + Claude usage, synthetic data, repo URL, video, team).

## Open blockers

- App credentials (Alex): one programmatic access token restricted to `CLINICIAN_ROLE` (roles now exist), pasted
  into `app/web/.env.local` as `SNOWFLAKE_PAT=`. The lab's login policy only accepts a token minted with the
  network-policy bypass window (`MINS_TO_BYPASS_NETWORK_POLICY_REQUIREMENT = 1440`). With one token, the Care agent
  switch is enforced by the app (labelled in the UI); Snowflake's own role grants are checked by `RUN_CHECKS()`.
  The app runs on sample data until the token is in.
- Faiz's open questions: CONTEXT-POOL.md §6 (several are now answered by his AI Plan design).

## How to run (as pieces land)

- SQL: `bash scripts/run_sql.sh` (Snowflake CLI connection `hackathon`), then `CALL CARE_RULES.CORE.RUN_CHECKS();`.
- App: `cd app/web && npm install && npm run dev` → http://localhost:3000.

Planning docs in `docs/tether/` were drafted earlier today as notes; all code and data are created during the event.
