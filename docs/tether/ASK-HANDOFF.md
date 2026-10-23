# Ask handoff

The Ask drawer answers care-team questions with a Cortex Agent over a semantic view, and shows the SQL that ran.
It is read only.

## What exists

| Piece | Where | Notes |
|---|---|---|
| Semantic view `CARE_RULES.CORE.TETHER_ANALYTICS` | `sql/70_semantic_view.sql` | Logical tables: `patients`, `diagnoses`, `readings`, `rules`, `firings` (`V_RULE_FIRINGS`), `drafts` (`ACTION_QUEUE`), `rule_edits`, `profiles` (`PATIENT_PROFILE` without `display_name`). Includes parsed `days_overdue` / `overdue_measure`, `is_red_flag`, `is_held`, `is_waiting`. Synonyms cover pending, waiting, approved, overdue and red flag. |
| Agent `CARE_RULES.CORE.TETHER_ASK` | `sql/80_agent.sql` | Orchestration model `claude-sonnet-4-5`; one tool `CareAnalyst` (`cortex_analyst_text_to_sql`) on `DEFAULT_WH`. The instructions say: read only, synthetic data, no diagnosis, never name a drug, class or dose, plain sentences with counts and SYN ids. `USAGE` on the agent and `SELECT`/`REFERENCES` on the semantic view are granted to `CARE_AGENT_ROLE` and `CLINICIAN_ROLE`. |
| Recorded answers | `ASK_CACHE` (seeded by `sql/80_agent.sql`) | One real agent run per suggested question, stored as `{text, sql, model, status}`, and each run is logged in `MODEL_CALLS` (`proc = 'ASK_SEED'`). A question already cached is not asked again. |
| Fixture | `app/web/src/fixtures/ask.json` | Exported from `ASK_CACHE` (`_source: "ASK_CACHE @ <ts>"`). Used when `DATA_MODE=fixtures`. |
| Server | `app/web/src/lib/ask.ts`, `app/web/src/app/api/ask/agent/route.ts` | `POST /api/ask/agent {question}` |
| UI | `app/web/src/components/ask/` | `AskDrawer`, `AskTrigger`, `StepProgress`, `SqlDisclosure`, shared contract `questions.ts` |

Both SQL files run clean twice with `snow sql -c hackathon -f <file>`. `scripts/run_sql.sh` also picks them up in numeric order.
The second run makes no agent calls.

## Wire it into the TopBar (lead)

In `app/web/src/components/shell/TopBar.tsx`:

```tsx
import { AskTrigger } from "../ask/AskDrawer";
```

Then replace `<AskButton />` with `<AskTrigger />`. The old `AskButton` popover can be deleted.

`AskTrigger` renders the same tertiary "Ask" button and opens the 440 px drawer. To open the drawer from somewhere else (a KPI tile, for example), use `<AskDrawer isOpen onOpenChange initialQuestion />`.

## API contract

`POST /api/ask/agent` with `{"question": "..."}` returns the standard envelope:
`{ok: true, data: AskAgentAnswer, fixtures, fixture_source?, acting_as}` or `{ok: false, error, fixtures, acting_as}`.

`AskAgentAnswer` (in `components/ask/questions.ts`): `question`, `answer` (text), `sql`, `source` (`'live'` or `'recorded'`), `model`,
`recorded_at`, `label` ("Live answer" or "Recorded answer (<recorded_at>)"), `message`, `check` (`sql_present`, `safety_terms_ok`, `notes`).

- **Live:** `SELECT SNOWFLAKE.CORTEX.DATA_AGENT_RUN(?, ?)` through `lib/snowflake.ts`, running as the acting role's token. The agent name and the request JSON are both bind values; the question is never put into the SQL text.
  The function only accepts a constant or bind value as the request, so binding is required, not just safer.
- **Parsing:** the final text is the response's `content[type=text]` items. The SQL is the last `tool_result` named `system_execute_sql` (`content[].json.sql`), and the model is `metadata.orchestration_model`.
- **Check:** the answer text is matched against `SAFETY_TERMS` (drug names, classes and dose units). A match is shown as a caution note with the answer.
- **Fallback:** on any live failure the route serves the latest `ASK_CACHE` row for that question, labelled "Recorded answer (<recorded_at>)".
- The old `POST /api/ask` (recorded only) is untouched; the drawer uses `/api/ask/agent`.

## Refresh the recorded answers

The answers in `ASK_CACHE` reflect the data at the time they were recorded. They were recorded at 14:10 PT, when the queue was empty and no threshold had been edited.
Once drafts and a threshold edit exist, record again:

```sql
DELETE FROM CARE_RULES.CORE.ASK_CACHE;   -- Tether table; recorded answers only
```

Then run `snow sql -c hackathon -f sql/80_agent.sql`. This makes three agent runs, about 80 s.
After that, refresh `app/web/src/fixtures/ask.json` from:

```sql
SELECT question, answer, TO_VARCHAR(recorded_at, 'YYYY-MM-DD HH24:MI') AS recorded_at
FROM CARE_RULES.CORE.ASK_CACHE
QUALIFY ROW_NUMBER() OVER (PARTITION BY question ORDER BY recorded_at DESC) = 1;
```

Each row in the fixture is `{"question", "answer": {"text", "sql", "model"}, "recorded_at"}`, and `_source` is `"ASK_CACHE @ <export time>"`.

## Verified

- `sql/70_semantic_view.sql` and `sql/80_agent.sql` each ran clean twice.
- `SELECT * FROM SEMANTIC_VIEW(...)` returns the current firings with parsed days overdue (for example SYN-013 ENG-4 BP 26).
- `DATA_AGENT_RUN` answers as `ATTENDEE_ROLE` and as `CARE_AGENT_ROLE`, with the request passed as a bind value.
- All three suggested questions have real recorded answers, each with its SQL and the model `claude-sonnet-4-5` from the response metadata.
- `parseAgentResponse` was run on a saved real agent response.
- `npx tsc --noEmit` and eslint are clean on the Ask files.
- `POST /api/ask/agent` was tested in fixtures mode: a recorded answer, an unknown question, and an empty question.
- The drawer was rendered and used in the browser on a throwaway page, since removed. It shows the suggested questions, step progress, the recorded label, the Marker provenance chip and the SQL disclosure, and Escape closes it.

**Not verified:** the live app path (`DATA_MODE=live` with a token). No access tokens exist yet, so the app falls back to fixtures.

## Known gaps

- Live Ask calls from the app are not logged in `MODEL_CALLS`. The app roles have no INSERT, and the app writes only through procedures.
  A small `LOG_ASK(question, answer)` procedure, with `USAGE` for both roles, would close this; it is not built.
- "Overdue" comes from `V_RULE_FIRINGS`, which keeps one firing per patient and condition (the most urgent wins).
  A COPD patient whose red flag outranks a missed SpO2 rung shows the red flag, not the overdue days. Add `V_MONITORED_VALUES` to the semantic view when it lands.
- The agent runs in about 15 to 40 s. The drawer shows its step progress while it waits.
