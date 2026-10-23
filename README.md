# Tether

Tether keeps patients with hypertension, COPD and type 2 diabetes tethered to their care plan. It watches home readings and labs in Snowflake, applies guideline rules (2025 AHA/ACC, GOLD 2026, ADA 2026), and uses Claude to draft the next step: a patient check-in, an AI follow-up call, or a request to the prescriber or pharmacy.

**A clinician approves every outbound action.** Tether does not diagnose and does not choose drugs or doses.

Built at the Intelligence at Work Hackathon (Snowflake x Anthropic), Oct 23, 2026. All code and data in this repo were created during the event. Data is synthetic; there is no real patient information.

## What's here

| Path | What it is |
| --- | --- |
| `docs/RUNBOOK.md` | The runbook: pathways, thresholds and sources, safety checks, follow-up ladder, AI check-in calls, approval gate, test scenarios, hackathon checklist |
| `docs/PITCH.md` | Two slides of pitch wording: clinician time, hospital admissions, life expectancy, lost workdays, families, with sources |
| `data/soap_notes.csv` | 45 synthetic SOAP notes; 14 end with a clinician-signed AI Plan |
| `data/gen_notes.py` | Generator for the notes |
| `sql/care_rules_snowflake.sql` | Snowflake schema, editable rules table, 15 synthetic patients and their notes, AI Plan parsing with safety checks, rule evaluation view, Claude drafting through Cortex AI_COMPLETE, clinician approval procedure |

## Run it

1. Open a SQL worksheet in Snowsight.
2. In `sql/care_rules_snowflake.sql`, set `CLAUDE_MODEL` to a Claude model available in your account.
3. Run the file top to bottom.
4. `SELECT * FROM V_PATIENT_OVERRIDES;` shows every AI Plan line and whether it was applied, blocked or held for confirmation.
5. `SELECT * FROM V_RULE_FIRINGS;` shows which rule fires for each patient, after the AI Plan.
6. `CALL GENERATE_DRAFTS();` has Claude write the drafts into `ACTION_QUEUE`.
7. `CALL REVIEW_ACTION(<id>, 'APPROVED', '<note>', NULL);` is the clinician gate. Only approved drafts appear in `V_READY_TO_SEND`.

## Built with

- Snowflake (tables, views, stored procedures, Cortex AI_COMPLETE)
- Claude (draft text and rule explanations)
