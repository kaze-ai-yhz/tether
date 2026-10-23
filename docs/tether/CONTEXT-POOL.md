# Context pool and AI Plan line · Tether v2

The clinical content is Dr. Faiz's `docs/RUNBOOK.md`; the P0 rules are his `RULES` table. This
doc covers only what Tether layers on top: the AI Plan line, P2 patient rules, P1 doctor rules,
Update P0, and the action types a step may use.

## 1. Layers

| Layer | Source | Can do | Cannot do |
|---|---|---|---|
| P0 | `RULES` (Faiz, cited) | Everything in his pathways | Change without a clinician edit (`UPDATE_RULE`, audited) |
| P1 (stretch) | Doctor's repeated custom lines, ≥ 5 consistent plans, one approval | Add or tighten a check for that doctor's patients | Loosen P0, touch red flags, pick a drug or dose |
| P2 | The patient's AI Plan line | Add or tighten a check for that patient; add a reminder or check-in | Same as P1 |

Red flags (`BP-RED`, `DM-RED`, proposed `COPD-RED`) are a floor. All outbound actions from any
layer go to `ACTION_QUEUE` and wait for a clinician.

## 2. Action types (the only "buckets")

Faiz's `RULES.action_type` values are the complete list: `READING_REMINDER`, `BARRIER_CHECKIN`,
`AI_CHECKIN_CALL`, `LOST_TO_FOLLOWUP`, `RECOMMEND_DEVICE`, `ADHERENCE_CHECKIN`, `LAB_REMINDER`,
`RECOMMEND_START`, `RECOMMEND_TITRATE`, `RECOMMEND_REVIEW`, `RECOMMEND_O2_EVAL`, `RECOMMEND_INTENSIFY`,
`URGENT_ALERT`, `NONE`. Proposed addition for custom lines: `LIFESTYLE_REMINDER` (patient,
verbatim text from the note, for example "Walk 20 minutes daily"). Faiz to approve.

A custom line asking for a medication change maps to `RECOMMEND_REVIEW` to the prescriber (the draft
names no drug or dose), or to Needs clinician if it cannot be mapped.

## 3. AI Plan line format

```
AI PLAN: Turn on auto follow-up. <Hypertension|COPD|Diabetes>. Standard.
AI PLAN: Turn on auto follow-up. <condition>. Custom: <plain-language rule>.
```

Examples (synthetic, Faiz to finalize):

```
AI PLAN: Turn on auto follow-up. COPD. Standard.
AI PLAN: Turn on auto follow-up. Hypertension. Custom: check home BP twice daily for 7 days before the 3-month review. Walk 20 minutes daily.
AI PLAN: Turn on auto follow-up. Diabetes. Custom: remind about A1C every 3 months even at goal.
AI PLAN: Turn on auto follow-up. COPD. Custom: double the inhaler if SpO2 drops.   <- not allowed: becomes Needs clinician (drug/dose)
```

Reader output is validated in code (ARCHITECTURE §3): known condition; `action_type` in §2; `quote`
present verbatim; tighter-or-equal than P0; no drug or dose words. Anything else → `unknown_text`
→ plan rejected → Needs clinician.

## 4. Demo enrollment (proposed AI Plan lines for the 14 SYN patients)

| Patient | Condition | Mode | Expected result (Faiz's table) |
|---|---|---|---|
| SYN-001 | HTN | Standard | BP-1 → recommend starting medication (prescriber) |
| SYN-002 | HTN | Standard | No action, at goal on lifestyle |
| SYN-003 | HTN | Standard | BP-2 → medication start, fixed-dose combination noted |
| SYN-004 | HTN | Standard | Adherence check-in, no escalation |
| SYN-005 | HTN | Standard | Red flag → urgent clinician alert |
| SYN-006 | COPD | Standard | COPD-3 → oxygen evaluation, no inhaler change |
| SYN-007 | COPD | Standard | COPD-2 → follow-up treatment review |
| SYN-008 | T2DM | Standard | DM-2 → intensification request |
| SYN-009 | T2DM | Standard | Red flag → urgent clinician alert |
| SYN-010 | T2DM | Custom (A1C every 3 months) | DM-1 → lab reminder |
| SYN-011 | HTN | Standard | ENG-3 → AI check-in call |
| SYN-012 | COPD | Standard | ENG-DEV → clinician orders device |
| SYN-013 | HTN | Standard | ENG-4 → lost-to-follow-up flag |
| SYN-014 | HTN | Custom (walk daily) | ENG-1 → reminder (+ lifestyle reminder from P2) |

Add one visited patient without an AI Plan line (SYN-015, Faiz) to show "not automated", and one
note with a disallowed custom line to show the rejection. For the P1 learner (stretch), ≥ 5 notes
from one doctor with the same custom rule.

## 5. Update P0 (stretch)

Faiz writes a short summary with citation and link into `GUIDELINE_SUMMARIES`. Claude proposes a
diff against `RULES` (rule id, field, old → new, citation). Each line needs a clinician approval;
approved lines go through `UPDATE_RULE`. Active plans for that condition get `guideline_changed`.

## 6. Questions for Dr. Faiz

- [ ] C-04: may a P2 rule ever loosen a P0 threshold (for example an individualized BP goal)?
- [ ] C-05: should the AI Plan line be required to enroll, or is a diagnosis enough?
- [ ] C-11: `COPD-RED` value and how the patient baseline is stored.
- [ ] Approve `LIFESTYLE_REMINDER` as an action type.
- [ ] Synthetic SOAP notes for SYN-001..015 with the AI Plan lines in §4.
- [ ] Drug and dose word list for the draft check (invariant 2).
- [ ] AI check-in call script text (approved once, per his runbook).
- [ ] Confirm each threshold against the full guideline text before the demo (his note).
