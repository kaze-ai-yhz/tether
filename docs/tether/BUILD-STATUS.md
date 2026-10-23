# Tether build status (live, updated at each milestone push)

Last update: Fri Oct 23, 2026, 13:25 PT, push M0 (planning docs). Freeze 15:30, submit 16:30.
Faiz's `README.md`, `docs/RUNBOOK.md` and `sql/care_rules_snowflake.sql` are unchanged and stay the source of truth.

## Where we are

| Milestone | Scope (BUILD-PLAN.md) | State |
|---|---|---|
| M0 Repo and base | Faiz's SQL run as is, 14 SYN firings checked, SOAP notes + AI Plan lines, Tether tables, roles | In progress |
| M1 Pool | `UPDATE_RULE` with audit, patient (P2) rules, `V_P2_FIRINGS`, `V_ALL_FIRINGS`, threshold edit changes the result | Not started |
| M2 Plans and queue | Claude reads the AI Plan line, todos (Table 1), drafts into `ACTION_QUEUE`, app queue with approve / edit / reject | App scaffold in progress |
| M3 Tracking | Simulated clock, ENG ladder, monitored values (Table 2), simulated AI check-in call with handoff, sends to `OUTBOX` | Not started |
| M4 Governance | Agent role cannot approve (real Snowflake roles), `RUN_CHECKS()` all PASS, demo reset | Not started |
| Stretch | Ask drawer (Cortex Agent over a semantic view) | Not started |
| Cut | P1 doctor-rule learner, Update P0 guideline ingest, Cortex Search | Not built |

## Verified in the lab account (read-only probes)

- `ATTENDEE_ROLE` can create the database and roles. Real roles `CARE_AGENT_ROLE` and `CLINICIAN_ROLE` are planned.
- Claude through Cortex `AI_COMPLETE`: `claude-opus-5-5`, `claude-sonnet-5-5` and `claude-sonnet-4-5` all answer.
  Structured JSON output works only on `claude-sonnet-4-5` (Faiz's default), so it reads the AI Plan line.
- Cross-region inference is enabled.

## Decisions taken by default (Faiz, please confirm or change)

- C-05: the AI Plan line in the SOAP note enrolls a patient. Patients without it are not automated; red flags still alert.
- C-04: patient (P2) rules from the AI Plan line can only add or tighten; red flags are a floor.
- A plan whose custom line is not allowed (drug or dose, loosening, unknown text) is shown as Needs clinician; the
  guideline (P0) rules keep running for that patient.
- `LIFESTYLE_REMINDER` (verbatim text from the note, for example "Walk 20 minutes daily") is used as an action type
  and is attached to the next patient message. Pending Faiz's approval.
- C-11: `COPD-RED` is a placeholder row with no value until Faiz sets it; it is never evaluated while empty.
- Red-flag alerts are internal clinician alerts with fixed text (no model). Every other outbound step waits in
  `ACTION_QUEUE` for a clinician.

## How you can help now (no code needed)

Please keep the 14 SYN patients' data as they are: they are Faiz's test table. New material goes in new files that
run after ours, so nothing waits on anyone.

1. **SOAP notes and AI Plan lines** (Faiz): put them in `sql/11_notes_faiz.sql`. For each patient, delete and
   reinsert the note:
   ```sql
   DELETE FROM CARE_RULES.CORE.SOAP_NOTES WHERE patient_id = 'SYN-014';
   INSERT INTO CARE_RULES.CORE.SOAP_NOTES (note_id, patient_id, doctor_id, visit_on, subjective, objective, assessment, plan)
   VALUES ('<same note_id as in sql/10_tether_notes.sql>', 'SYN-014', 'DR-SYNTHETIC', '2026-10-13',
           '<S>', '<O, only values already in the seed>', '<A, the diagnosis already in DIAGNOSES>',
           '<plan text> AI PLAN: Turn on auto follow-up. Hypertension. Custom: Walk 20 minutes daily.');
   ```
   AI Plan line format (one line, at the end of the plan):
   `AI PLAN: Turn on auto follow-up. <Hypertension|COPD|Diabetes>. Standard.` or
   `AI PLAN: Turn on auto follow-up. <condition>. Custom: <plain-language rule>.`
   Our draft notes (marked "pending Faiz review") land in `sql/10_tether_notes.sql` with the next push.
2. **Drug and dose word list** (Faiz): rows for the draft safety check, in `sql/16_safety_terms_faiz.sql`:
   `INSERT INTO CARE_RULES.CORE.SAFETY_TERMS (term, kind, source) VALUES ('<drug name>', 'DRUG_NAME', 'Faiz');`
   (kinds: `DRUG_CLASS`, `DRUG_NAME`, `DOSE_UNIT`; note `mg/dL` is a glucose unit, not a dose).
3. **AI check-in call script** (Faiz, approved once per the runbook): plain text in `docs/tether/CALL-SCRIPT.md`.
4. **COPD-RED**: the resting SpO2 red-flag value and how the patient baseline is stored.
5. **Extra synthetic patients** (anyone): new ids from `SYN-017`, each with a diagnosis, medications by class,
   readings and the expected result in one sentence, in `sql/17_extra_patients.sql`. Synthetic only, no PHI.
6. **One-minute video script** (UI-UX.md §3) and the submission text (COCO-KICKOFF checklist).

## Open blockers

- App credentials (Alex): two role-restricted programmatic access tokens, minted after the roles exist. The lab's
  login policy only accepts a token from a user under a network policy, or within the bypass window set when the
  token is minted. Exact statements will be posted here. The app runs on fixture data until then.
- Faiz's open questions: CONTEXT-POOL.md §6.

## How to run (as pieces land)

- SQL: `bash scripts/run_sql.sh sql/care_rules_snowflake.sql sql/10_tether_notes.sql …` (Snowflake CLI connection
  `hackathon`), then `CALL CARE_RULES.CORE.RUN_CHECKS();`.
- App: `cd app/web && npm install && npm run dev` → http://localhost:3000 (fixture data until tokens exist).

Planning docs in `docs/tether/` were drafted earlier today as notes; all code and data are created during the event.
