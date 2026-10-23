# Data model · Tether v2

All objects live in `CARE_RULES.CORE`. **Faiz's tables are the base and are not redefined**; read
them in `sql/care_rules_snowflake.sql`. Tether adds the tables below in `sql/10_…`–`90_…`. All
data synthetic. Uncertain syntax is marked **TODO-verify**.

## 1. Faiz's objects (summary, his file is authoritative)

| Object | Role in Tether |
|---|---|
| `AS_OF(as_of_date)` | Simulated clock (days) |
| `PATIENTS` | Risk flags, PREVENT %, individualized `a1c_goal` |
| `DIAGNOSES` | HTN / COPD / T2DM, stage, diagnosing clinician |
| `MEDICATIONS` | Drug **class** only |
| `READINGS` | BP, SPO2, A1C, GLUCOSE, EXACERBATION, ADHERENCE, BARRIER (codes 1–4) |
| `RULES` | **P0 layer**, editable thresholds, cadence (`CAD-*`), ladder (`ENG-*`), citations |
| `ACTION_QUEUE` | Drafts: PENDING → APPROVED / EDITED / REJECTED → SENT |
| `AUDIT_LOG` | Who did what, when |
| `V_RULE_FIRINGS` | P0 evaluation, one action per patient per condition, most urgent wins |
| `GENERATE_DRAFTS()` / `REVIEW_ACTION(...)` / `V_READY_TO_SEND` | Drafting and the clinician gate |

## 2. Tether additions

```sql
-- 10_tether_notes.sql
CREATE TABLE IF NOT EXISTS PATIENT_PROFILE (patient_id VARCHAR, display_name VARCHAR,  -- synthetic; never sent to a model
  doctor_id VARCHAR, next_visit_on DATE, ai_call_consent BOOLEAN, phone_ok BOOLEAN);
CREATE TABLE IF NOT EXISTS SOAP_NOTES (note_id VARCHAR, patient_id VARCHAR, doctor_id VARCHAR,
  visit_on DATE, subjective VARCHAR, objective VARCHAR, assessment VARCHAR, plan VARCHAR,
  ai_plan_text VARCHAR);          -- extracted by SQL from PLAN; NULL = no AI Plan line

-- 20_tether_pool.sql
CREATE TABLE IF NOT EXISTS PATIENT_RULES (rule_id VARCHAR, patient_id VARCHAR, condition VARCHAR,  -- P2
  reading_type VARCHAR, op VARCHAR, value1 FLOAT, value2 FLOAT, window_days INT, min_readings INT,
  action_type VARCHAR, recipient VARCHAR, quote VARCHAR, note_id VARCHAR, active BOOLEAN);
CREATE TABLE IF NOT EXISTS DOCTOR_RULES  LIKE PATIENT_RULES;   -- P1 (stretch); doctor_id instead of patient_id
CREATE TABLE IF NOT EXISTS RULE_PROPOSALS (proposal_id VARCHAR, doctor_id VARCHAR, condition VARCHAR,
  proposed VARIANT, support_count INT, example_note_ids ARRAY, status VARCHAR,  -- PENDING|APPROVED|DISMISSED
  decided_by VARCHAR, decided_at TIMESTAMP_NTZ);
CREATE TABLE IF NOT EXISTS RULE_EDITS (edit_id NUMBER AUTOINCREMENT, rule_id VARCHAR, field VARCHAR,
  old_value VARCHAR, new_value VARCHAR, reason VARCHAR, edited_by VARCHAR, edited_at TIMESTAMP_NTZ);
CREATE TABLE IF NOT EXISTS GUIDELINE_SUMMARIES (doc_id VARCHAR, condition VARCHAR, citation VARCHAR,
  url VARCHAR, summary VARCHAR, written_by VARCHAR);   -- Faiz-written summaries, no pasted guideline text

-- 30_tether_plans.sql
CREATE TABLE IF NOT EXISTS CARE_PLANS (plan_id VARCHAR, patient_id VARCHAR, condition VARCHAR,
  note_id VARCHAR, mode VARCHAR,                       -- standard|custom
  status VARCHAR,                                      -- ACTIVE|REJECTED|CLOSED
  validation VARIANT, guideline_changed BOOLEAN, composer_model VARCHAR, created_at TIMESTAMP_NTZ);
CREATE TABLE IF NOT EXISTS TODOS (todo_id VARCHAR, plan_id VARCHAR, patient_id VARCHAR, seq INT,  -- Table 1
  todo_text VARCHAR, rule_id VARCHAR, layer VARCHAR,   -- P0|P1|P2
  due_on DATE, done BOOLEAN);

-- 50_tether_adapters.sql
CREATE TABLE IF NOT EXISTS OUTBOX (msg_id NUMBER AUTOINCREMENT, action_id NUMBER, channel VARCHAR,  -- SMS|AI_CALL|PRESCRIBER|PHARMACY|INTERNAL_ALERT
  payload VARCHAR, provider VARCHAR DEFAULT 'simulated', sent_at TIMESTAMP_NTZ);
CREATE TABLE IF NOT EXISTS CALL_TRANSCRIPTS (call_id NUMBER AUTOINCREMENT, action_id NUMBER, patient_id VARCHAR,
  attempt INT, outcome VARCHAR,                        -- ANSWERED|NO_ANSWER|HANDOFF|ID_FAILED
  transcript VARCHAR, answers VARIANT, rule_id VARCHAR, at_sim DATE);
CREATE TABLE IF NOT EXISTS MODEL_CALLS (call_id NUMBER AUTOINCREMENT, proc VARCHAR, model VARCHAR,
  input_text VARCHAR, output VARCHAR, at TIMESTAMP_NTZ);
CREATE TABLE IF NOT EXISTS APPROVERS (user_name VARCHAR, role_label VARCHAR);  -- fallback if roles can't be created
CREATE TABLE IF NOT EXISTS ASK_CACHE (question VARCHAR, answer VARIANT, recorded_at TIMESTAMP_NTZ);
```

Audit: Tether writes to Faiz's `AUDIT_LOG` (`actor`, `event`, `action_id`, `detail`) with events
`AI_PLAN_READ`, `PLAN_COMPOSED`, `PLAN_REJECTED`, `RULE_EDITED`, `CLOCK_ADVANCED`, `DRAFTS_GENERATED`,
`SENT`, `CALL_ATTEMPT`, `CALL_HANDOFF`, `PROPOSAL_DECIDED`. Never updated or deleted.

## 3. Views

| View | Purpose |
|---|---|
| `V_P2_FIRINGS` | Patient (and P1) rules evaluated against `READINGS` and `AS_OF`; same columns as `V_RULE_FIRINGS` plus `layer` |
| `V_ALL_FIRINGS` | `V_RULE_FIRINGS` (P0) ∪ `V_P2_FIRINGS`; one per patient per condition by priority; red flags always win |
| `V_MONITORED_VALUES` | **Table 2**: patient × reading type, resource, last value + date, `collect_flag`, `action_flag`, days overdue, rung |
| `V_QUEUE` | Pending drafts with evidence, rule, step, citation, recent readings |
| `V_PATIENT_LIST` | Per patient: synthetic name, SYN id, conditions, mode, todo progress, display status, next visit |
| `V_PATIENT_DETAIL` | Header, AI Plan line, todos, firings, drafts, sends, calls |
| `V_TIMELINE` | `AUDIT_LOG` for a patient, readable |

## 4. Display statuses

| Status | When |
|---|---|
| Scheduled | Visit ahead, no AI Plan read yet |
| Awaiting approval | Any PENDING draft for the patient (added per C-06) |
| Needs clinician | Red flag (`URGENT_ALERT`), a firing with recipient CLINICIAN (BP-4, COPD-3, DM-3, ENG-4, ENG-DEV), call handoff, or a rejected plan |
| Action taken | Latest draft approved and sent; waiting for the next reading or reply |
| Pending | Enrolled, waiting on readings, ladder not yet past ENG-1 |
| Ongoing follow-up | At goal (BP-5, COPD-4, DM-4), monitoring continues |
| Complete | Plan closed by a clinician |

Patient status = most severe across conditions: Needs clinician > Awaiting approval > Action taken
> Pending > Ongoing follow-up > Complete > Scheduled. A visited patient without an AI Plan line
shows "Visited · no AI Plan" (neutral, not automated).

## 5. Invariants (`sql/99_checks.sql`)

1. Nothing in `OUTBOX` without an `ACTION_QUEUE` row in APPROVED or EDITED (red-flag internal alerts excepted).
2. No draft text names a drug or a dose (keyword check against `MEDICATIONS` classes and dose units; Faiz to extend).
3. Every SYN patient's firing matches the runbook "Expected result" table (14 rows).
4. Changing a `RULES` threshold changes `V_RULE_FIRINGS` (edit, check, revert).
5. No `PATIENT_RULES` row loosens a P0 threshold or touches a red-flag rule.
6. Every `TODOS` row resolves to an active rule.
7. No `MODEL_CALLS.input_text` contains a `PATIENT_PROFILE.display_name`.
8. One open draft per patient per condition.
9. The agent role cannot call `REVIEW_ACTION` (if roles exist).
