# UI and UX · Tether v2

Care-team web app, Next.js on `localhost:3000`, dark theme on stage. Tokens and components:
`DESIGN-SYSTEM.md`. Visual reference: the design review and `diagrams/`. **Not dashboard-first**:
the hero is the approval queue and the rule engine behind it.

## 1. Principles
- A clinician approves every outbound action; the UI never sends on its own.
- Every line shows its rule id, pathway step, citation and the readings that fired it.
- Status = word + icon + color. Simulated things (clock, calls, adapters) are labeled.
- Drafts never name a drug or dose.

## 2. Screens

### 2.1 Approval queue (home, primary)
List of PENDING drafts, red flags pinned on top as urgent alerts. Each card: SYN id + synthetic
name, condition, rule id + step + citation, evidence string, recent readings sparkline, recipient,
Claude's draft and "Why:" line (`ModelChip`), buttons **Approve · Edit · Reject** (reject needs a
reason). Batch approve allowed for reading reminders only (Faiz's routing table).

### 2.2 Patients tab
Table: patient, conditions, AI Plan mode (Standard / Custom / none), todo progress, current rung or
step, status chip (Scheduled, Awaiting approval, Needs clinician, Action taken, Pending, Ongoing
follow-up, Complete). Sort by status rank.

### 2.3 Patient detail
Header · AI Plan line quoted with P2 rules highlighted · **Todos** (Table 1) with `LayerChip`
P0/P1/P2 and rule id · **Monitored values** (Table 2): per reading type last value, collect and
action flags, days overdue, ladder rung · drafts and decisions · AI check-in call transcript ·
timeline from `AUDIT_LOG`.

### 2.4 Rules tab (the context pool)
Faiz's `RULES` grouped by condition and step, with citation. **Edit threshold** (clinician only):
change a value, give a reason, see "V_RULE_FIRINGS: 2 patients changed" and which. This is the
Craft-with-Snowflake moment. Stretch: proposed doctor rules (P1) card; Update P0 diff view.

### 2.5 Ask drawer (stretch)
Cortex Agent over the semantic view: "Who is overdue on SpO2?", "Which drafts are waiting and
why?", "What did the last threshold edit change?" Shows the SQL.

### 2.6 Top bar and demo panel
"As of Oct 23, 2026 (simulated)" · Acting as: **Care agent / Clinician** (role switch, shows the
agent cannot approve) · demo panel: +1 d, +2 d, +5 d, +10 d, +21 d, Next event; simulate call
(answered with a reading / no answer / reports chest pain); Reset demo.

## 3. One-minute video path

| Time | Screen | Action | Line |
|---|---|---|---|
| 0:00 | Queue | Pinned red flag SYN-005 | "Tether is care-team workflow automation. A clinician approves every action." |
| 0:10 | Patient SYN-014 | AI Plan line → todos P0/P2 | "One line in the visit note turns on follow-up." |
| 0:20 | Demo panel | +10 d on SYN-011 → AI check-in call draft → approve → simulated call | "Missed readings climb a ladder; the call collects, never advises." |
| 0:32 | Queue | SYN-006: oxygen evaluation, not an inhaler change | "Rules come from GOLD, AHA/ACC and ADA, in Snowflake." |
| 0:42 | Rules | Edit `COPD-3` threshold, result changes; switch to Care agent, Approve is disabled | "Thresholds are rows; roles enforce the gate." |
| 0:52 | Patients | Statuses after approvals | "Synthetic data. Built today." |

The 3-minute live demo walks the 14 SYN patients in Faiz's order.
