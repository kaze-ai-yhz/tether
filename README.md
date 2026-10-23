# Tether

Tether keeps patients with hypertension, COPD and type 2 diabetes tethered to their care plan. It watches home readings and labs in Snowflake, applies guideline rules (2025 AHA/ACC, GOLD 2026, ADA 2026), and uses Claude to draft the next step: a patient check-in, an AI follow-up call, or a request to the prescriber or pharmacy.

**A clinician approves every outbound action.** Tether does not diagnose and does not choose drugs or doses.

Built at the Intelligence at Work Hackathon (Snowflake x Anthropic), Oct 23, 2026. All code and data in this repo were created during the event. Data is synthetic; there is no real patient information.

## What's here

| Path | What it is |
| --- | --- |
| `docs/RUNBOOK.md` | The runbook: pathways, thresholds and sources, safety checks, follow-up ladder, AI check-in calls, approval gate, test scenarios, hackathon checklist |
| `sql/care_rules_snowflake.sql` | Snowflake schema, editable rules table, 14 synthetic patients, rule evaluation view, Claude drafting through Cortex AI_COMPLETE, clinician approval procedure |

## Run it

1. Open a SQL worksheet in Snowsight.
2. In `sql/care_rules_snowflake.sql`, set `CLAUDE_MODEL` to a Claude model available in your account.
3. Run the file top to bottom.
4. `SELECT * FROM V_RULE_FIRINGS;` shows which rule fires for each patient.
5. `CALL GENERATE_DRAFTS();` has Claude write the drafts into `ACTION_QUEUE`.
6. `CALL REVIEW_ACTION(<id>, 'APPROVED', '<note>', NULL);` is the clinician gate. Only approved drafts appear in `V_READY_TO_SEND`.

## Built with

- Snowflake (tables, views, stored procedures, Cortex AI_COMPLETE)
- Claude (draft text and rule explanations)
