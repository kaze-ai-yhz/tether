# Architecture · Tether v2 (consolidated)

**Base:** Dr. Faiz's `docs/RUNBOOK.md` and `sql/care_rules_snowflake.sql` (commit 078ad38) are the
clinical and data foundation. This kit layers the design-review ideas **on top** where they do not
conflict. Where they conflict, Faiz's clinical content and safety stance win; open items are in
§0.2 for Alex and Faiz.

## 0. Decisions

### 0.1 Defaults (Alex and Dr. Faiz to confirm)

| # | Decision | Default |
|---|---|---|
| D-01 | Data layout | **Keep Faiz's names**: database `CARE_RULES`, schema `CORE`, his tables unchanged. Tether additions are new objects in `CARE_RULES.CORE`, created by `sql/10_…`–`99_…` files that run after his file and never redefine his objects |
| D-02 | Approval | A clinician approves **every** outbound action (`ACTION_QUEUE` → `REVIEW_ACTION`). Plans are composed at once; each outbound step waits in the queue |
| D-03 | Drugs and doses | Drafts never choose a drug or dose. The strongest medication action is a recommendation to the prescriber naming the guideline step |
| D-04 | P0 layer | Faiz's `RULES` table is the P0 layer and the editable threshold source |
| D-05 | Switch | The AI Plan line in the SOAP note enrolls a patient and picks Standard or Custom; patients without it are not automated |
| D-06 | P2 (patient) rules | Custom AI Plan rules can **add or tighten** a check for that patient; they never loosen or remove a P0 rule or red flag, and they map only to Faiz's action types |
| D-07 | Collection policy | Faiz's day-based ladder: ENG-1 at 2 d, ENG-2 at 5 d, ENG-3 AI check-in call at 10 d, ENG-4 at 21 d, ENG-DEV on no device |
| D-08 | Clock | Faiz's `AS_OF` table is the simulated clock, advanced in days by `ADVANCE_CLOCK(days)`; no Snowflake tasks |
| D-09 | Statuses | Six review statuses plus **Awaiting approval** (see DATA-MODEL §4) |
| D-10 | Conditions | Hypertension (2025 AHA/ACC), COPD (GOLD 2026), type 2 diabetes (ADA 2026), all three end to end; the 14 SYN patients are the demo script |
| D-11 | Stretch / cut first | P1 pattern learner, Update P0 guideline ingest, Ask drawer, Cortex Search citations |
| D-12 | Models | `CLAUDE_MODEL` per Faiz's file (set to the newest Claude listed in the account); Sonnet-class for reading the AI Plan line and drafts, Opus-class for plan composing and learner if available. Model ids TODO-verify via `SNOWFLAKE.CORTEX` model list |

### 0.2 Conflicts for Alex and Faiz

| # | Design review (12:10) | Faiz (078ad38) | Kit default |
|---|---|---|---|
| C-01 | Start actions at once when grounded | Clinician approves every outbound action | Faiz: compose at once, every outbound step queued |
| C-02 | COPD pulse ox < 92 (P0) / < 93 (custom) → **double dose** | Low SpO2 (≤ 88 % repeated) → **oxygen evaluation**, never inhaler escalation; no drug or dose choice | Faiz. Example removed. A custom "double the prescription" line becomes a prescriber dose-review recommendation, or Needs clinician |
| C-03 | Hourly retry, phone call at 6 h, then Needs clinician | Day ladder ENG-1..4, AI call at 10 d, one retry next day, two missed calls → ENG-4 | Faiz |
| C-04 | Precedence P2 > P1 > P0 (patient can override guideline value) | Thresholds are team-editable rows; individualized A1C goal per patient | P2 may only add or tighten (D-06). Faiz to confirm whether loosening is ever allowed |
| C-05 | AI Plan line is the only trigger | Every diagnosed patient in `DIAGNOSES` is evaluated | AI Plan line enrolls (D-05); demo seeds AI Plan lines for all 14 SYN patients. Faiz to confirm |
| C-06 | Six statuses | Queue statuses PENDING/APPROVED/EDITED/REJECTED/SENT | Added "Awaiting approval" |
| C-07 | Demo: COPD + BP end to end; diabetes, flu vaccine, stool test as entries | HTN, COPD, T2DM, all with pathways | Faiz's three. Flu vaccine and stool-test screening dropped (no clinical content); re-add as entries only if wanted |
| C-08 | Hourly clock (+1 h, +6 h, +48 h) | Daily dates (`AS_OF`, `taken_on DATE`) | Days |
| C-09 | Composer: Opus; Sonnet reads | `CLAUDE_MODEL` default `claude-sonnet-4-5` via AI_COMPLETE | D-12 |
| C-10 | Faiz README flow step 5: "Cortex Agent running Claude writes the draft" | His SQL drafts with `AI_COMPLETE` | AI_COMPLETE for drafts; Cortex Agent only for the Ask drawer |
| C-11 | Red-flag SpO2 floor value | "well below baseline, set by the clinician"; no row in `RULES` | Add `COPD-RED` row with a PLACEHOLDER value and per-patient baseline; Faiz to set |
| C-12 | Roles shown to judges | Role DDL is commented out; `ATTENDEE_ROLE` may not be allowed to create roles | TODO-verify; fallback in §8 |
| C-13 | Judging time 16:45 (review) | Submission 16:30 (checklist) | Submit by 16:30; judging time TODO-verify |
| C-14 | Patient B "88 → call + double dose" | 88 % repeated → COPD-3 oxygen evaluation | Faiz |
| C-15 | Guideline PDFs into the pool (Update P0) | Cite and link; do not paste large passages | Faiz: store citations and Faiz-written summaries only |

## 1. Flow

```
SOAP note (synthetic) ── AI Plan line ──▶ READ_AI_PLAN (Claude, AI Plan text only, patient token)
        │                                          │ mode standard | custom, P2 rules (validated)
        ▼                                          ▼
 DIAGNOSES / READINGS / MEDICATIONS        CARE_PLANS + TODOS (Table 1), composed at once
        │                                          │
        ▼                                          ▼
 V_RULE_FIRINGS (Faiz, P0 RULES)  ∪  V_P2_FIRINGS (patient rules)  =  V_ALL_FIRINGS
        │  red flags first · enough data · adherence first · trial window · duplicate guard
        ▼
 DRAFT_ACTIONS() ── Claude AI_COMPLETE ──▶ ACTION_QUEUE (PENDING)
        ▼
 Clinician: REVIEW_ACTION (approve / edit / reject + reason)  ──▶ V_READY_TO_SEND
        ▼
 SEND_APPROVED() → simulated adapters (SMS, AI check-in call, prescriber, pharmacy) → OUTBOX
        ▼
 AUDIT_LOG (every firing, draft, decision, send, call, clock step)
```

Diagrams d1–d5 in `docs/tether/diagrams/` are the design-review visual reference. Where they show
"double dose", hourly retries or auto-start, this document wins.

## 2. Context pool

| Layer | What | Where | Status |
|---|---|---|---|
| P0 guideline | Faiz's pathway rules with citations | `RULES` (his table) + `RULE_EDITS` history | Core |
| P1 doctor | Rules learned from a doctor's repeated custom lines (≥ 5 consistent plans), active after one approval | `RULE_PROPOSALS` → `DOCTOR_RULES` | Stretch |
| P2 patient | Custom rules from the AI Plan line | `PATIENT_RULES` | Core |

Effective rule for a patient = P0 always evaluated (Faiz's view, untouched) **plus** P1/P2 rules that
add or tighten. Red flags (`BP-RED`, `DM-RED`, `COPD-RED`) are a floor nobody can lower.

**Threshold edit (Craft check, core):** `UPDATE_RULE(rule_id, field, value, reason)` (clinician role)
updates `RULES`, writes `RULE_EDITS` and `AUDIT_LOG`; `V_RULE_FIRINGS` changes on the next query.

**Update P0 (stretch):** Faiz pastes a guideline summary → Claude proposes `RULES` diffs (added /
changed) with citations → clinician approves each → `UPDATE_RULE`. Active plans get a
`guideline_changed` flag; nothing outbound changes without approval.

**P1 learner (stretch):** `LEARN_PATTERNS(doctor_id, condition)`: SQL counts identical normalized
P2 rules across that doctor's plans; ≥ 5 → proposal card; approve → `DOCTOR_RULES`.

## 3. Plans (Table 1)

`READ_AI_PLAN(note_id)`: Claude reads only the AI Plan section, with the patient replaced by the
SYN token. Output JSON `{condition, mode, custom_rules[{reading_type, op, value, window_days,
action_type, quote}], unknown_text[]}`. Code validates: `action_type` must be one of Faiz's action
types; `quote` must be a substring of the AI Plan text; anything naming a drug or dose, or
loosening a P0 rule, is rejected to Needs clinician.

`COMPOSE_PLAN(patient_id, condition)`: Claude turns the patient's pathway step, cadence and P2
rules into a readable todo list; each todo carries `rule_id` and `layer`. `VALIDATE_PLAN` checks
every todo resolves to an active rule, every red flag of the condition is present, and no todo is
an outbound send (those come only from `ACTION_QUEUE`). Failure → plan `rejected` → Needs clinician.

## 4. Tracking (Table 2) and ladder

Table 2 is the view `V_MONITORED_VALUES` over Faiz's `monitored`/`eng` logic: one row per patient ×
expected reading type with resource (home device, lab, patient report, AI call), last value,
`collect_flag` (reading received within cadence), `action_flag` (a rule fired on it), days overdue
and current rung (ENG-1..4 / ENG-DEV).

`ADVANCE_CLOCK(days)` moves `AS_OF`, then `TICK()` = `DRAFT_ACTIONS()`; drafts appear as PENDING.
The AI check-in call (ENG-3) runs only after its draft is approved: `SIMULATE_CHECKIN_CALL(action_id,
scenario)` has Claude play the agent against a synthetic patient, writes `CALL_TRANSCRIPTS`, logs any
reading to `READINGS` (`source = 'PATIENT_REPORT'`), and on symptoms, a red-flag value, a medical
question, a request for a person, or failed identity check creates an urgent clinician alert. No
answer → retry next day → second miss → ENG-4.

## 5. Runtime

Next.js app on `localhost:3000`, server-side calls to the Snowflake SQL API (PAT in
`app/web/.env.local`) and the Agent Run API for Ask. Routes: `GET /api/patients`,
`GET /api/patients/:id`, `GET /api/queue`, `POST /api/queue/:id/review`, `GET /api/rules`,
`POST /api/rules/:id` (threshold edit), `POST /api/notes/:id/read`, `POST /api/clock` (days ∈ 1, 2,
5, 10, 21, next), `POST /api/calls/:id/simulate`, `POST /api/ask`, `POST /api/demo/reset`.
"Acting as" switch: Care agent / Clinician (maps to roles, §8).

## 6. Security

Synthetic data only. Model inputs: AI Plan text, SYN ids, evidence strings; never names, DOB or
MRN (synthetic names live only in `PATIENT_PROFILE`). Every model call logged in `MODEL_CALLS`.
Agent role can insert drafts but cannot approve or send. PAT server-side only.

## 7. Fallbacks

| Risk | Fallback |
|---|---|
| Role creation not allowed for `ATTENDEE_ROLE` | Keep his commented grants in the repo, show them; enforce in `REVIEW_ACTION` by an `APPROVERS` table check and label "role check simulated" |
| `$CLAUDE_MODEL` not resolved inside the proc | Paste the model name (Faiz's note) |
| AI_COMPLETE slow | Cache drafts in `ACTION_QUEUE`; demo reset keeps them |
| Agent API trouble | Ask drawer shows recorded answers from `ASK_CACHE`, labeled |
| App trouble | Snowsight worksheet demo using Faiz's README steps |

## 8. Fixed names

| Thing | Value |
|---|---|
| Database / schema | `CARE_RULES` / `CORE` (Faiz) |
| Faiz objects (do not redefine) | `AS_OF`, `PATIENTS`, `DIAGNOSES`, `MEDICATIONS`, `READINGS`, `RULES`, `ACTION_QUEUE`, `AUDIT_LOG`, `V_RULE_FIRINGS`, `GENERATE_DRAFTS`, `REVIEW_ACTION`, `V_READY_TO_SEND`, roles `CARE_AGENT_ROLE`, `CLINICIAN_ROLE` |
| Tether tables | `SOAP_NOTES`, `PATIENT_PROFILE`, `CARE_PLANS`, `TODOS`, `PATIENT_RULES`, `DOCTOR_RULES`, `RULE_PROPOSALS`, `RULE_EDITS`, `GUIDELINE_SUMMARIES`, `CALL_TRANSCRIPTS`, `OUTBOX`, `MODEL_CALLS`, `APPROVERS`, `ASK_CACHE` |
| Tether views | `V_P2_FIRINGS`, `V_ALL_FIRINGS`, `V_MONITORED_VALUES`, `V_PATIENT_LIST`, `V_PATIENT_DETAIL`, `V_QUEUE`, `V_TIMELINE` |
| Tether procs | `READ_AI_PLAN`, `COMPOSE_PLAN`, `VALIDATE_PLAN`, `DRAFT_ACTIONS`, `SEND_APPROVED`, `UPDATE_RULE`, `ADVANCE_CLOCK`, `TICK`, `SIMULATE_CHECKIN_CALL`, `LEARN_PATTERNS`, `APPROVE_PROPOSAL`, `DEMO_RESET` |
| Ask | semantic view `CORE.TETHER_ANALYTICS`, agent `CORE.TETHER_ASK` (read only); search `CORE.GUIDELINE_SEARCH` (stretch, citations only) |
| Connection / role / warehouse | `hackathon` / `ATTENDEE_ROLE` / `DEFAULT_WH` |

## 9. Repo layout

```
README.md                      Faiz (do not overwrite)
docs/RUNBOOK.md                Faiz: clinical source of truth
sql/care_rules_snowflake.sql   Faiz: base schema, rules, 14 SYN patients, drafts, approval gate
sql/10_tether_notes.sql        SOAP_NOTES, PATIENT_PROFILE, AI Plan lines for SYN-001..014
sql/20_tether_pool.sql         PATIENT_RULES, DOCTOR_RULES, RULE_PROPOSALS, RULE_EDITS, UPDATE_RULE
sql/30_tether_plans.sql        READ_AI_PLAN, CARE_PLANS, TODOS, COMPOSE_PLAN, VALIDATE_PLAN
sql/40_tether_tracking.sql     V_P2_FIRINGS, V_ALL_FIRINGS, V_MONITORED_VALUES, DRAFT_ACTIONS, ADVANCE_CLOCK, TICK
sql/50_tether_adapters.sql     OUTBOX, SEND_APPROVED, CALL_TRANSCRIPTS, SIMULATE_CHECKIN_CALL
sql/60_tether_views.sql        app views
sql/70_semantic_view.sql, 80_agent.sql   Ask (stretch)
sql/90_demo.sql                DEMO_RESET
sql/99_checks.sql              evals
CLAUDE.md                      working agreement for CoCo
docs/tether/                   this kit (ARCHITECTURE, DATA-MODEL, CONTEXT-POOL, UI-UX, DESIGN-SYSTEM, SAFETY, BUILD-PLAN, diagrams)
app/web/                       Next.js app
```
