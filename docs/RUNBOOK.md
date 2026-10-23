# Tether: Chronic Care Rules Runbook

Oct 23, 2026

## Purpose and guardrails

The system watches home readings and labs for patients with an existing, clinician-made diagnosis of hypertension, COPD or type 2 diabetes. When a guideline rule fires, it drafts the next step and puts it in a queue. **A clinician approves every outbound action. Nothing reaches a patient, pharmacy or prescriber automatically.**

It is a care-team workflow tool: it reduces the time from an out-of-range reading to a clinician decision, and closes the gap where patients stay above goal with no change (clinical inertia).

**In scope**

- Tracking readings against guideline targets and intervals
- Drafting patient check-ins, lifestyle reminders, and prescriber or pharmacy requests
- Routing red-flag readings to a clinician immediately
- Logging every rule firing and approval with its guideline source

**Out of scope**

- Diagnosis of any condition. Every pathway starts from a diagnosis already in the record.
- Choosing a specific drug or dose. The draft names the guideline step (for example, "add a second agent"); the clinician picks the drug.
- Any autonomous contact with patients, pharmacies or prescribers
- Real patient data. The hackathon build uses synthetic patients only.

## Guideline sources

Every rule cites one of these three documents. Thresholds live in a rules table so a clinician can update them without code changes.

| Condition | Guideline | Published | Key numbers used |
| --- | --- | --- | --- |
| Hypertension | [2025 AHA/ACC Guideline for High Blood Pressure in Adults](https://www.guidelinecentral.com/insights/aug-2025-accaha-bp-guideline-video/) | Aug 14, 2025 | Goal under 130/80; PREVENT 10-year risk cutoff 7.5%; 3 to 6 month lifestyle trial for low-risk stage 1 |
| COPD | [GOLD 2026 Report](https://goldcopd.org/wp-content/uploads/2025/11/KEY-CHANGES-GOLD-2026-10Nov2025.pdf) | Nov 2025 | Follow-up treatment by dyspnea and exacerbations; one moderate exacerbation prompts escalation review; oxygen evaluation at resting SpO2 of 88% or lower |
| Type 2 diabetes | [ADA Standards of Care in Diabetes 2026](https://pmc.ncbi.nlm.nih.gov/articles/PMC12690178) | Dec 2025 | A1C goal under 7% for many adults (under 8% when less stringent is appropriate); A1C every 3 months when not at goal; intensify within 3 months |

Before demo day, a clinician on the team confirms each threshold against the full text. Secondary summaries were used to draft this runbook.

## System flow and data model

Snowflake holds the data and the rules; Claude drafts the messages and explains which rule fired; a clinician decides.

1. New readings land in Snowflake (home BP, SpO2, A1C, glucose, symptom scores, exacerbations).
2. A scheduled stored procedure evaluates each patient's pathway step against the rules table.
3. Red flags skip the queue and create an urgent clinician alert.
4. Other fired rules run the adherence check first, then create a draft action.
5. A Cortex Agent running Claude writes the draft text and cites the rule and guideline section.
6. The clinician approves, edits or rejects the draft in the approval queue.
7. Approved actions go out; every step is written to the audit log.

| Table | Holds |
| --- | --- |
| PATIENTS | Synthetic ID, age, risk flags (diabetes, CKD, clinical CVD), PREVENT 10-year risk, A1C goal |
| DIAGNOSES | Condition, date diagnosed, diagnosing clinician |
| MEDICATIONS | Drug class, dose, start and change dates, active flag |
| READINGS | Type, value, unit, timestamp, source (home device, lab, patient report) |
| RULES | Rule ID, condition, pathway step, threshold, interval days, action type, guideline citation |
| CARE_PLAN_STATE | Current step per patient per condition, step start date, next review date |
| ACTION_QUEUE | Draft text, rule fired, recipient type, status (pending, approved, edited, rejected, sent) |
| AUDIT_LOG | Who did what and when, with the rule and data that triggered it |

## Blood pressure pathway

The goal is an average home BP under 130/80. Entry point depends on stage and risk, both already in the record. Source: 2025 AHA/ACC guideline.

| Step | Entry condition | Check | Rule fires when | Draft action | To |
| --- | --- | --- | --- | --- | --- |
| BP-1 Lifestyle trial | Stage 1 (130 to 139 / 80 to 89), PREVENT under 7.5%, no diabetes, CKD or clinical CVD | Home BP average every 4 weeks; review at 3 months, final at 6 months | Average still 130/80 or higher at the 3 to 6 month review | Recommend starting medication | Prescriber |
| BP-1 check-ins | Same | Monthly | Fewer than the minimum home readings logged | Reminder to measure and log BP; lifestyle reminder | Patient |
| BP-2 Start medication | Stage 2 (140/90 or higher), or stage 1 with diabetes, CKD, clinical CVD, prior stroke or PREVENT 7.5% or higher | At diagnosis | Entry condition met | Recommend medication plus lifestyle (stage 2: guideline prefers a fixed-dose combination) | Prescriber |
| BP-3 Titrate | On medication | Home BP average monthly after each change | Average 130/80 or higher after an adequate trial, adherence confirmed | Recommend dose increase or adding an agent | Prescriber, then pharmacy |
| BP-4 Resistant | Above 140/90 on three agents, or needing four or more | At each review | Criteria met | Flag possible resistant hypertension for clinician review | Clinician |
| BP-5 At goal | Average under 130/80 | Every 3 months | Stays at goal | No action; log and continue monitoring | None |

Minimum data before any BP rule fires: a home average built from at least 12 readings over 7 days (configurable). Thresholds and intervals are rows in the RULES table.

## COPD pathway

GOLD 2026 bases follow-up treatment on breathlessness and exacerbations, not on pulse oximetry. Inhalers rarely raise resting SpO2, so a persistently low SpO2 routes to an oxygen evaluation, never to repeated inhaler increases. Source: GOLD 2026.

| Step | Watches | Rule fires when | Draft action | To |
| --- | --- | --- | --- | --- |
| COPD-1 Monitor | Daily resting SpO2, weekly dyspnea score (mMRC or CAT), exacerbations | Missing readings for the set interval | Reminder to log SpO2 and symptoms | Patient |
| COPD-2 Symptom or exacerbation review | Dyspnea score, exacerbation events | Dyspnea worse than baseline, or one moderate exacerbation | Adherence and inhaler technique check first; if confirmed, recommend follow-up treatment review | Patient, then prescriber |
| COPD-3 Oxygen evaluation | Resting SpO2 | Resting SpO2 of 88% or lower on repeated readings while stable | Recommend clinician evaluation for long-term oxygen (confirmation by arterial blood gas is the clinician's call) | Clinician |
| COPD-4 Stable | All of the above | No exacerbations, stable symptoms and SpO2 | No action; review at the set interval | None |

Example: a patient with SpO2 88% who started an inhaler and whose SpO2 does not rise with dose changes lands in COPD-3. The system stops suggesting inhaler changes for SpO2 and asks a clinician to evaluate for oxygen.

## Diabetes pathway

Each patient carries an individualized A1C goal set by the clinician: under 7% by default, under 8% when a less stringent goal fits. The system never sets the goal. Source: ADA Standards of Care 2026.

| Step | Watches | Rule fires when | Draft action | To |
| --- | --- | --- | --- | --- |
| DM-1 A1C schedule | Date of last A1C | No A1C in 3 months (not at goal) or 6 months (at goal) | Lab reminder | Patient |
| DM-2 Above goal | Latest A1C vs patient goal | A1C above goal, adherence confirmed | Recommend treatment intensification within 3 months | Prescriber, then pharmacy |
| DM-3 Hypoglycemia | Home glucose or CGM | Glucose under 70 mg/dL (level 1) recurring | Clinician review of regimen; patient check-in | Clinician, patient |
| DM-3 Hypoglycemia, urgent | Home glucose or CGM | Glucose under 54 mg/dL (level 2), or any severe event | Urgent clinician alert | Clinician |
| DM-4 At goal | A1C | At or below goal | No action; next A1C in 6 months | None |

## Safety checks and contact routing

These run before any pathway rule and apply to all three conditions.

1. **Red flags first.** These bypass the schedule and create an urgent clinician alert, never a routine draft:
   - BP 180/120 or higher
   - Resting SpO2 well below the patient's baseline (threshold set by the clinician)
   - Glucose under 54 mg/dL or a severe hypoglycemia event
2. **Enough data.** No rule fires on a single reading. Each rule has a minimum count and window.
3. **Adherence before escalation.** Before any medication escalation draft, the system drafts a patient check-in on adherence, side effects and (for COPD) inhaler technique. Escalation goes forward only after that is answered or the clinician overrides.
4. **Recent change.** No escalation while a medication change is still inside its trial window.
5. **Duplicate guard.** One open draft per patient per condition at a time.

**Who gets contacted**

| Action type | Recipient | Sent only after |
| --- | --- | --- |
| Reading or lab reminder | Patient | Clinician approval (batch approval allowed) |
| Lifestyle reminder, adherence check-in | Patient | Clinician approval |
| Start, increase or add medication | Prescriber | Clinician approval |
| Prescription change to fill | Pharmacy | Prescriber has signed the order |
| Red flag | Clinician on call | Sent immediately as an internal alert |

## Follow-up and compliance

Missing data is never treated as "at goal." A patient who stops sending readings moves up a follow-up ladder until the care team reaches them. Day counts are team defaults stored in the RULES table, not guideline numbers.

**Expected home readings**

| Condition | Measure | Expected at least every |
| --- | --- | --- |
| Hypertension | Home BP | 7 days (twice daily for the week before each review) |
| COPD | Resting SpO2 | 1 day |
| Diabetes on insulin | Home glucose | 3 days |
| Diabetes, all | A1C | 3 months if not at goal, 6 months if at goal (DM-1) |

**Missed-reading ladder** (days past the expected cadence)

| Rung | Days overdue | Draft action | To |
| --- | --- | --- | --- |
| ENG-1 | 2 | Friendly reminder to measure and log | Patient |
| ENG-2 | 5 | Second reminder plus a barrier question: no device, forgot, unsure how, cost | Patient |
| ENG-3 | 10 | AI check-in call (see AI check-in calls) | Patient |
| ENG-4 | 21 | At risk of lost to follow-up: clinician flag, offer a clinic or telehealth visit | Clinician |

**Barrier routing**

- **No device or broken device** (for example, no pulse oximeter): draft to clinician to order a device or arrange clinic readings. Pathway rules pause and the pause is visible, so no rule waits silently on data that cannot arrive.
- **Forgot:** patient picks reminder times; reminders move to those times.
- **Unsure how to measure:** send instructions, walk through them on the AI check-in call, and book a nurse teach-back if still unsure.
- **Cost or access:** route to pharmacy or social work.

**Medication adherence**

- Monthly adherence check-in for anyone on a medication in these pathways, and before every escalation.
- An unanswered adherence check-in climbs the same ladder.
- Missed doses reported: no escalation; adherence support first (see Safety checks).

**Reviews still happen.** If a scheduled review (for example, the end of the 3 to 6 month lifestyle trial) arrives without enough readings, the ladder fires instead of the review being skipped.

### AI check-in calls

At 10 days overdue, an AI voice agent calls the patient instead of a nurse or MA. The call collects information only; it never advises.

**What the call does**

1. Says up front that it is an automated AI assistant calling for the care team.
2. Confirms identity with two identifiers before discussing anything.
3. Asks for today's reading if the patient can take it during the call (BP, SpO2 or glucose) and logs it.
4. Asks the barrier question (no device, forgot, unsure how, cost) and the adherence questions.
5. Offers reminder times and logs the patient's choice.
6. Writes a transcript and structured answers back to Snowflake, tagged with the rule that triggered the call.

**Hand off to a human, immediately, if**

- The patient reports symptoms (chest pain, shortness of breath, confusion, low-sugar symptoms) or a reading in the red-flag range. The call tells them to call 911 for an emergency and alerts the on-call clinician.
- The patient asks a medical question or asks for a person.
- Identity cannot be confirmed.

**If the call fails**

- No answer: one retry the next day, then a text with a callback number.
- Two unanswered calls: move to ENG-4, the clinician flag.

**Guardrails**

- Patient consent to automated calls is recorded at enrollment; no consent means a human call instead. The FCC treats AI-generated voices as artificial voices under the TCPA, so consent and disclosure rules apply. Confirm the details with counsel before real use.
- The call script is approved by a clinician once; each call batch still passes the approval queue.
- Every call, transcript and handoff is in the audit log.
- For the hackathon demo, the call is simulated: Claude plays the agent against a synthetic patient and writes the transcript to Snowflake. No real calls are placed.

## Clinician approval gate

Every draft waits in ACTION_QUEUE with status pending. The send step only reads rows with status approved, and only a clinician role can set that status (Snowflake role-based access).

Each queue item shows the clinician:

- The patient's recent readings that triggered it
- The rule ID, pathway step and guideline citation
- The draft text Claude wrote, with its reasoning
- Approve, edit, or reject (reject requires a reason)

Governance made visible for judges:

- The agent's Snowflake role can insert drafts but cannot set status to approved or sent
- Every approval writes the clinician ID and timestamp to AUDIT_LOG
- Rejected drafts and their reasons are kept, so rules can be tuned

## Test scenarios

Fourteen synthetic patients walk every branch, including four for follow-up. The same list is the demo script; `sql/care_rules_snowflake.sql` seeds them.

| Patient | Situation | Expected result |
| --- | --- | --- |
| SYN-001 | Stage 1, PREVENT 4%, home average 136/84 after 4 months of lifestyle | BP-1 fires: draft "recommend starting medication" to prescriber |
| SYN-002 | Stage 1, PREVENT 3%, home average 126/78 at 3 months | No action; at goal on lifestyle |
| SYN-003 | Stage 2, home average 152/96, new diagnosis | BP-2 fires: draft medication start, fixed-dose combination noted |
| SYN-004 | On one agent 6 weeks, average 138/86, missed doses reported | Adherence check-in to patient; no escalation yet |
| SYN-005 | Home reading 186/122 | Red flag: urgent clinician alert, no routine draft |
| SYN-006 | COPD, SpO2 87 to 88% on repeated resting readings, inhaler dose already raised | COPD-3 fires: oxygen evaluation request to clinician; no inhaler change |
| SYN-007 | COPD, one moderate exacerbation last month, good adherence | COPD-2 fires: follow-up treatment review to prescriber |
| SYN-008 | Diabetes, goal under 7%, A1C 8.1% on metformin, adherence confirmed | DM-2 fires: intensification request to prescriber |
| SYN-009 | Diabetes, glucose 51 mg/dL logged | Red flag: urgent clinician alert |
| SYN-010 | Diabetes, A1C 6.6%, last test 7 months ago | DM-1 fires: lab reminder to patient |
| SYN-011 | Stage 1 lifestyle trial, no BP logged for 18 days | ENG-3 fires: AI check-in call to patient |
| SYN-012 | COPD, reports no pulse oximeter at home | ENG-DEV fires: clinician asked to order a device or arrange clinic readings |
| SYN-013 | On BP medication, no readings for over a month | ENG-4 fires: lost-to-follow-up flag and visit offer |
| SYN-014 | Stage 1, forgot to log BP for 9 days | ENG-1 fires: reminder to patient |

## Hackathon compliance checklist

Tick each before the 4:30 PM submission. Source: the [event participant guide](https://cerebralvalley.ai/e/intelligence-at-work-hackathon/details).

**Avoiding disqualification**

- [ ] Pitch it as care-team workflow automation (internal theme), not as an AI that gives medical advice. Say "a clinician approves every action" in the first 20 seconds of the demo.
- [ ] The demo shows the approval queue. Nothing is sent without a clinician click.
- [ ] No diagnosis anywhere; every patient starts with a diagnosis in the record.
- [ ] The drafts never name a drug or dose on their own; the clinician chooses.
- [ ] Not a dashboard-first project: the core is the rules engine, agent and approval workflow.
- [ ] Not a basic RAG chatbot: rules evaluate structured data in Snowflake; retrieval only supplies citations.
- [ ] New work only: all code written today. No code from any earlier project.
- [ ] Synthetic data only. No real patients, no PHI.
- [ ] Guideline text: cite and link it; do not paste large passages into the repo.

**Submission requirements**

- [ ] Team of three or fewer, every member approved on the event listing
- [ ] All teammates added on the Submit Project form
- [ ] Public GitHub repository, checked from a logged-out browser
- [ ] One-minute demo video showing only what was built today
- [ ] README separates what was built at the hackathon from any libraries used

**Judging fit (Craft with Snowflake and Claude, 10%)**

- [ ] Data, rules and audit log live in Snowflake with role-based access shown
- [ ] Claude runs through Cortex (agent or AI_COMPLETE) to draft and explain
- [ ] Show a rule threshold being edited in the table and the result changing
