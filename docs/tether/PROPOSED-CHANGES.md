# Proposed changes for Dr. Faiz

Tether never edits `sql/care_rules_snowflake.sql`, `docs/RUNBOOK.md` or `README.md`. Everything below
is a proposal; nothing here has been applied to your files. Checked live in the lab account on
2026-10-23 (Snowflake CLI connection `hackathon`, role `ATTENDEE_ROLE`) against your commit `60fe5f1`.

## 1. `GENERATE_DRAFTS` cannot read `$CLAUDE_MODEL`

Every run of your file stops at `CALL GENERATE_DRAFTS();` with:

```
090244 (42601): Uncaught exception of type 'STATEMENT_ERROR' on line 5 at position 2 :
Use of session variable '$CLAUDE_MODEL' is not allowed in owners rights stored procedure
```

The procedure has no `EXECUTE AS` clause, so it runs with owner's rights, and an owner's-rights
procedure cannot read the caller's session variables. As a result:

- no drafts are created (ACTION_QUEUE is empty after the file runs);
- `snow sql -f` stops at that CALL (exit 1), so section 6 (`REVIEW_ACTION`, `V_READY_TO_SEND`) is
  not created unless the rest of the file is run separately.

Tether's runner (`scripts/run_sql.sh`) runs your file unchanged in two parts split at that line and
tolerates only this failure. Tether drafts with its own procedure, which reads the model id from a
settings table into a variable.

**Proposed fix:** pass the model as an argument with a default; the CALL passes your session
variable. Diff against `60fe5f1`:

```diff
--- a/sql/care_rules_snowflake.sql
+++ b/sql/care_rules_snowflake.sql
@@ -941,7 +941,10 @@
 -- ---------------------------------------------------------------------
 SET CLAUDE_MODEL = 'claude-sonnet-4-5';   -- replace with the newest Claude model listed in your account
 
-CREATE OR REPLACE PROCEDURE GENERATE_DRAFTS()
+-- The model is an argument: an owner's-rights procedure cannot read the caller's session variables.
+-- Drop the old zero-argument version first; it would make the DEFAULT ambiguous.
+DROP PROCEDURE IF EXISTS GENERATE_DRAFTS();
+CREATE OR REPLACE PROCEDURE GENERATE_DRAFTS(p_model VARCHAR DEFAULT 'claude-sonnet-4-5')
 RETURNS VARCHAR
 LANGUAGE SQL
 AS
@@ -952,7 +955,7 @@
   INSERT INTO ACTION_QUEUE (patient_id, condition, rule_id, recipient, evidence, patient_prefs, draft_text)
   SELECT f.patient_id, f.condition, f.rule_id, f.recipient, f.evidence, f.patient_prefs,
          SNOWFLAKE.CORTEX.AI_COMPLETE(
-           $CLAUDE_MODEL,
+           :p_model,
            'You draft messages for a care team. A clinician will review and approve this draft before anything is sent. '
            || 'Do not diagnose. Do not name a specific drug or dose; refer only to the guideline step. '
            || 'Recipient: ' || f.recipient || '. Action: ' || f.action_type || '. '
@@ -972,10 +975,7 @@
 END;
 $$;
 
--- If $CLAUDE_MODEL is not resolved inside the procedure in your account,
--- paste the model name directly in place of $CLAUDE_MODEL above.
-
-CALL GENERATE_DRAFTS();
+CALL GENERATE_DRAFTS($CLAUDE_MODEL);
 SELECT action_id, patient_id, rule_id, recipient, status, draft_text FROM ACTION_QUEUE ORDER BY action_id;
 
 -- ---------------------------------------------------------------------
@@ -1023,7 +1023,7 @@
 -- GRANT USAGE ON SCHEMA CARE_RULES.CORE TO ROLE CLINICIAN_ROLE;
 -- GRANT SELECT ON ALL TABLES IN SCHEMA CARE_RULES.CORE TO ROLE CARE_AGENT_ROLE;
 -- GRANT SELECT ON ALL VIEWS IN SCHEMA CARE_RULES.CORE TO ROLE CARE_AGENT_ROLE;
--- GRANT USAGE ON PROCEDURE GENERATE_DRAFTS() TO ROLE CARE_AGENT_ROLE;
+-- GRANT USAGE ON PROCEDURE GENERATE_DRAFTS(VARCHAR) TO ROLE CARE_AGENT_ROLE;
 -- GRANT SELECT ON ALL TABLES IN SCHEMA CARE_RULES.CORE TO ROLE CLINICIAN_ROLE;
 -- GRANT SELECT ON ALL VIEWS IN SCHEMA CARE_RULES.CORE TO ROLE CLINICIAN_ROLE;
 -- GRANT USAGE ON PROCEDURE REVIEW_ACTION(NUMBER, VARCHAR, VARCHAR, VARCHAR) TO ROLE CLINICIAN_ROLE;
```

What was checked live (throwaway `TEST_S1_*` procedures, dropped afterwards):

- An owner's-rights procedure with `p_model VARCHAR DEFAULT 'claude-sonnet-4-5'` returns the default
  on `CALL p()` and the session value on `CALL p($CLAUDE_MODEL)`.
- A set-based `AI_COMPLETE(:p_model, ...)` over `V_RULE_FIRINGS` inside such a procedure compiles and runs.
- Without the `DROP` line, rerunning on a database that still has the old procedure fails with
  `000949 (42723): Cannot overload PROCEDURE ... as it would cause ambiguous PROCEDURE`. With it, the
  first run and reruns succeed.
- Not run end to end with the real drafting call, to avoid 14 model calls before you agree. At
  AS_OF 2026-10-23 it would draft 14 rows: `V_RULE_FIRINGS` has 15, and SYN-008's `HOLD` row
  (recipient `NONE`) is skipped.

The other route the file comment mentions (a model name pasted into the procedure) also works,
but it hard-codes the model. If you adopt the diff, `scripts/run_sql.sh` notices that the line
`CALL GENERATE_DRAFTS();` is gone and runs your file whole. Your drafts are kept, and Tether's
drafting follows your rule of one open draft per patient per condition, so it skips those patients.

## 2. COPD red flag (`COPD-RED`, C-11)

RUNBOOK safety check 1 lists "Resting SpO2 well below the patient's baseline (threshold set by the
clinician)" as a red flag. `RULES` has no COPD red-flag row and `V_RULE_FIRINGS` has no branch for
it, so a very low resting SpO2 reaches the clinician today only through COPD-3 (priority 10, after 3
readings at or below 88 % in 14 days), not as an urgent alert.

Proposal, with every clinical value left for you (Tether does not invent clinical numbers):

**a. Rule row.** All thresholds NULL until you set them. While they are NULL the branch in (c)
never fires, because comparisons with NULL are not true.

```sql
INSERT INTO RULES VALUES
 ('COPD-RED', 'COPD', 'Red flag', NULL, NULL, NULL, NULL, 1, 'URGENT_ALERT', 'CLINICIAN',
  'PLACEHOLDER · Faiz to set: resting SpO2 well below the patient''s baseline (RUNBOOK red flag; threshold set by the clinician)');
```

- `threshold1`: points below the patient's baseline that count as "well below".
- `threshold2`: optional absolute floor for patients with no baseline on file (NULL = none).
- `window_days`: how recent the reading must be.
- `priority` 1, the same as BP-RED and DM-RED.

**b. Where the baseline lives.** As an AI Plan key, so the clinician sets it in the note and the
latest signed note wins:

```sql
INSERT INTO OVERRIDE_KEYS VALUES
 ('spo2 baseline', 'SPO2_BASELINE', 'NUM', NULL, NULL, NULL, NULL, NULL,
  'Patient''s usual resting SpO2 (%), used by the COPD red flag');
```

The note line would read `- SpO2 baseline: 92%` (example value only). It must not say "red flag":
that phrase is in `SAFETY_LOCKED_TERMS`, so the line would be `SAFETY_BLOCKED`. With NULL
`min_value`/`max_value`, `V_PATIENT_OVERRIDES` accepts any number, so please set a sanity range.
The alternative is a `PATIENTS` column next to `a1c_goal`.

**c. Branch in `V_RULE_FIRINGS`** (in the `firings` CTE, next to the BP red flag; compiled against
the live schema):

```sql
  UNION ALL
  -- COPD-RED: resting SpO2 well below the patient's baseline, or below an absolute floor
  SELECT x.patient_id, 'COPD', 'COPD-RED',
         'Resting SpO2 ' || x.value1::INT || '% on ' || x.taken_on
         || COALESCE(' (baseline ' || ob.num1::INT || '%)', '')
  FROM READINGS x
  CROSS JOIN d
  JOIN r ON r.rule_id = 'COPD-RED'
  LEFT JOIN ov ob ON ob.patient_id = x.patient_id AND ob.setting = 'SPO2_BASELINE'
  WHERE x.reading_type = 'SPO2'
    AND x.taken_on > DATEADD('day', -r.window_days, d.as_of_date)
    AND (x.value1 <= ob.num1 - r.threshold1 OR x.value1 < r.threshold2)
```

With priority 1 it wins over COPD-3 in your `QUALIFY`. `HOLD` does not apply to it, because your
`adjusted` CTE holds only BP-1, BP-2, BP-3, COPD-2, COPD-3 and DM-2.

Questions:
1. How many points below baseline is "well below"? Is there an absolute floor for patients without
   a baseline?
2. How recent must the reading be? The sketch fires on one reading, like BP-RED and DM-RED; should
   it need more?
3. Baseline as an AI Plan key (with which sanity range) or as a `PATIENTS` column?

## 3. Model ids in this account

`SHOW MODELS IN SCHEMA SNOWFLAKE.MODELS` lists `claude-opus-5-5`, `claude-sonnet-5-5` and
`claude-haiku-5-5` as the newest Claude models. Results with `AI_COMPLETE`:

| Model id | Plain call | `model_parameters => {'temperature': 0}` | Structured output (`response_format`) |
|---|---|---|---|
| `claude-sonnet-4-5` (your default) | answers | works | works |
| `claude-opus-5-5` | answers | works | returns NULL |
| `claude-sonnet-5-5` | answers | NULL: "Request failed for external function COMPLETE. Error: malformed request" | returns NULL |
| `claude-haiku-5-5` | not tested | not tested | not tested |

Sources: checked in this step and logged in `MODEL_CALLS`: the `model_parameters` column
(`MODEL_PARAMS_PROBE`, `MODEL_PARAMS_DIAGNOSE`) and the plain call on `claude-sonnet-5-5`
(`MODEL_ID_BIND_PROBE`). The plain calls on the other two ids and the structured-output column come
from the lead's earlier probe and were not rerun here.

Your default `claude-sonnet-4-5` works, so changing `SET CLAUDE_MODEL` is optional. If you pick a
newer id, your prompt (a plain call without options) works on both `claude-opus-5-5` and
`claude-sonnet-5-5`. With fix 1, `CALL GENERATE_DRAFTS($CLAUDE_MODEL)` uses whatever the line sets.
Tether reads its ids from `TETHER_SETTINGS`: reader `claude-sonnet-4-5` (structured output), composer
`claude-opus-5-5`, drafter and caller `claude-sonnet-5-5` (called without `model_parameters`).
