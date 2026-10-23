# CLAUDE.md: working agreement for this repo

You are building **Tether** today on top of Dr. Faiz's first commit: a chronic-care rules engine
in Snowflake (hypertension, COPD, type 2 diabetes) where Claude drafts the next step and **a
clinician approves every outbound action**. Read in this order:

1. `docs/RUNBOOK.md` (Faiz: clinical source of truth; it wins over everything else)
2. `sql/care_rules_snowflake.sql` (Faiz: base schema, RULES, 14 SYN patients, drafts, approval gate)
3. `README.md` (Faiz)
4. `docs/tether/ARCHITECTURE.md` (decisions, **conflicts list**, fixed names, layout)
5. `docs/tether/DATA-MODEL.md`
6. `docs/tether/CONTEXT-POOL.md` (AI Plan line, P0/P1/P2, action types)
7. `docs/tether/SAFETY.md`
8. `docs/tether/UI-UX.md` and `docs/tether/DESIGN-SYSTEM.md`
9. `docs/tether/BUILD-PLAN.md` (timed milestones, checks, cuts)

Visual reference (not code): `~/hackathon/tether-design/tether-review.html` and `docs/tether/diagrams/`.
Where the review shows double dose, hourly retries or auto-start, ARCHITECTURE §0.2 wins.

## Fixed names

| Thing | Value |
|---|---|
| Snowflake CLI connection | `hackathon` (`snow sql -c hackathon -f ...`) |
| Coding agent | Cortex Code CLI (`cortex -c hackathon`), Claude Opus 5.5 in the model picker; Claude Code as backup |
| Role / warehouse | `ATTENDEE_ROLE` / `DEFAULT_WH` (shared; be frugal) |
| Database / schema | `CARE_RULES` / `CORE` (Faiz's names) |
| Claude in SQL | `SNOWFLAKE.CORTEX.AI_COMPLETE` with Faiz's `CLAUDE_MODEL` (set to the newest Claude listed in the account; TODO-verify ids) |
| Everything else | `docs/tether/ARCHITECTURE.md` §8 |

## Guardrails (hard rules)

1. **Build on Faiz's SQL; do not rewrite it.** Never edit, reorder or reformat
   `sql/care_rules_snowflake.sql`, `docs/RUNBOOK.md` or `README.md`. Tether objects go in new files
   `sql/10_…`–`99_…`. If his file needs a change, write the proposed diff to `docs/tether/PROPOSED-CHANGES.md` for Faiz.
2. **A clinician approves every outbound action.** Nothing is sent unless its `ACTION_QUEUE` row is
   APPROVED or EDITED. No auto-send path, ever.
3. **No diagnosis, no drug or dose.** Drafts name the guideline step only. COPD low SpO2 routes to
   oxygen evaluation, never to inhaler escalation.
4. **Safety checks first** (red flags, enough data, adherence before escalation, recent change,
   duplicate guard). P1/P2 rules can only add or tighten; red flags are a floor.
5. **Only the AI Plan section goes to Claude** for reading, with the SYN id as the patient token.
   Log every model input in `MODEL_CALLS`.
6. **Synthetic data only.** No real patients, no PHI. Label simulated clock, calls and adapters.
7. **Thresholds are rows.** Read them from `RULES`; never hard-code a clinical number. Do not invent
   clinical values; ask Faiz (CONTEXT-POOL §6).
8. **Audit every write** in `AUDIT_LOG`; never update or delete it. The app writes only through procs.
9. **Numbers come from queries.** Nothing on screen, in the README or the video is typed by hand.
10. **No secrets in git.** PAT only in `app/web/.env.local` (git-ignored), server-side only.
11. **Commit per milestone** (`git commit -m "M<n>: <what>"`). **Never push**; Alex pushes after review.
12. Uncertain Snowflake syntax is marked `TODO-verify`; check with one statement, then remove the marker.

## Conventions

- SQL: numbered files, idempotent (`CREATE ... IF NOT EXISTS` for Tether tables), upper-case names
  in `CARE_RULES.CORE`. One DDL writer at a time (the `tether-sql` worktree).
- App: Next.js (App Router, TypeScript) in `app/web/`, `react-aria-components`, CSS variables from
  DESIGN-SYSTEM, server-only Snowflake client (SQL API with bindings; Agent Run API for Ask).
- UI voice: calm, specific, sentence case, no exclamation marks, no sparkle icons.
- Do not add tests beyond `sql/99_checks.sql` unless asked.
