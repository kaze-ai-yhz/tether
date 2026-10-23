# Tether kit (planning notes)

These notes extend Dr. Faiz's `README.md`, `docs/RUNBOOK.md` and `sql/care_rules_snowflake.sql`.
His files are the source of truth for clinical content and the data layer; nothing here overrides
them. Drafted earlier today as planning notes; all code and data in the repo are created during the
event.

**What Tether adds on top of the rules engine:** the AI Plan line in the visit note as the switch
(Standard or Custom), patient-level (P2) and doctor-level (P1, stretch) rules that can only add or
tighten, Table 1 todos and Table 2 monitored values per patient, a simulated clock in days, a
care-team app centered on the approval queue, threshold editing with audit, and an Ask drawer
(stretch).

Read in order: `ARCHITECTURE.md` (decisions, conflicts, fixed names) → `DATA-MODEL.md` →
`CONTEXT-POOL.md` → `SAFETY.md` → `UI-UX.md` + `DESIGN-SYSTEM.md` → `BUILD-PLAN.md`.
`diagrams/` holds the design-review sources (d1–d5), updated to Faiz's approval gate and ladder; where they differ from ARCHITECTURE, ARCHITECTURE wins.

Team: Alex Yang and Faiz (physician, clinical lead).
