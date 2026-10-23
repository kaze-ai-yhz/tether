-- =====================================================================
-- Ask: Cortex Agent CARE_RULES.CORE.TETHER_ASK (read only) over the semantic view TETHER_ANALYTICS.
-- One tool: CareAnalyst (cortex_analyst_text_to_sql) on DEFAULT_WH. Runs after sql/70_semantic_view.sql.
-- Idempotent: CREATE OR REPLACE AGENT; grants repeat as no-ops.
-- =====================================================================
USE SCHEMA CARE_RULES.CORE;

CREATE OR REPLACE AGENT CARE_RULES.CORE.TETHER_ASK
  COMMENT = 'Tether Ask: read-only answers over the approval queue, rule firings, rules, readings and threshold edits (synthetic data)'
  PROFILE = '{"display_name": "Tether Ask"}'
  FROM SPECIFICATION
$$
models:
  orchestration: claude-sonnet-4-5

orchestration:
  budget:
    seconds: 60
    tokens: 16000

instructions:
  system: >
    You answer questions from a care team about Tether, a chronic-care follow-up tool for hypertension,
    COPD and type 2 diabetes. All patients are synthetic (ids SYN-001 to SYN-015 and later SYN ids);
    there is no real patient data. You are read only: you never create, change, approve or send anything.
    A clinician approves every outbound action.
  orchestration: >
    Use the CareAnalyst tool for every question about drafts, the approval queue, rule firings, rules,
    thresholds, readings, overdue measures, red flags or threshold edits. Answer only from the rows the
    tool returns; if the tool returns no rows, say so plainly. Never guess counts.
    "Waiting" or "pending" drafts are drafts with status PENDING. "Overdue" means the days_overdue or
    overdue_measure of a current rule firing. "Red flag" means a firing whose action type is URGENT_ALERT.
    "The last threshold edit" is the rule edit with the latest edited_at.
  response: >
    Answer in two to five plain sentences, sentence case, no exclamation marks, no markdown tables.
    Give counts and the SYN ids involved, and name the rule id and its step when it explains why.
    Do not diagnose. Never name a drug, drug class, medication or dose; say "current medication" if needed.
    Do not give treatment advice; refer to the guideline step the rule names and leave decisions to the clinician.
    Mention that the data is synthetic only when asked about patients' identity.
  sample_questions:
    - question: "Who is overdue on SpO2?"
    - question: "Which drafts are waiting and why?"
    - question: "What did the last threshold edit change?"

tools:
  - tool_spec:
      type: "cortex_analyst_text_to_sql"
      name: "CareAnalyst"
      description: >
        Text to SQL over the semantic view CARE_RULES.CORE.TETHER_ANALYTICS: synthetic patients and
        diagnoses, home readings, guideline rules and thresholds, current rule firings (including the
        missed-reading ladder with days overdue, red flags and held escalations), the approval queue of
        drafts with their status, and clinician threshold edits.

tool_resources:
  CareAnalyst:
    semantic_view: "CARE_RULES.CORE.TETHER_ANALYTICS"
    execution_environment:
      type: "warehouse"
      warehouse: "DEFAULT_WH"
      query_timeout: 60
$$;

-- Read access for the two app roles: the agent, and the semantic view it queries.
-- (Both roles already read every table and view in the schema; see sql/12_tether_roles_base.sql.)
GRANT USAGE ON AGENT CARE_RULES.CORE.TETHER_ASK TO ROLE CARE_AGENT_ROLE;
GRANT USAGE ON AGENT CARE_RULES.CORE.TETHER_ASK TO ROLE CLINICIAN_ROLE;
GRANT SELECT ON SEMANTIC VIEW CARE_RULES.CORE.TETHER_ANALYTICS TO ROLE CARE_AGENT_ROLE;
GRANT SELECT ON SEMANTIC VIEW CARE_RULES.CORE.TETHER_ANALYTICS TO ROLE CLINICIAN_ROLE;
GRANT REFERENCES ON SEMANTIC VIEW CARE_RULES.CORE.TETHER_ANALYTICS TO ROLE CARE_AGENT_ROLE;
GRANT REFERENCES ON SEMANTIC VIEW CARE_RULES.CORE.TETHER_ANALYTICS TO ROLE CLINICIAN_ROLE;

-- ---------------------------------------------------------------------
-- Recorded answers (ASK_CACHE) for the Ask drawer's fallback: each one is a real agent run.
-- A question already in ASK_CACHE is not asked again. To record a fresh answer after the data
-- changes, delete that question's rows from ASK_CACHE and run this file again.
-- answer = {text, sql, model, status}: the agent's final text, the SQL its CareAnalyst tool ran,
-- and the orchestration model reported in the response metadata.
-- The request body must be a constant or a bind value, so the agent runs once per question in a
-- loop with the request in a variable. Every run is logged in MODEL_CALLS (ok = FALSE when the
-- agent returned no text).
-- ---------------------------------------------------------------------
EXECUTE IMMEDIATE $$
DECLARE
  q VARCHAR;
  req VARCHAR;
  resp VARCHAR;
  answer_json VARCHAR;
  recorded INTEGER DEFAULT 0;
  todo CURSOR FOR
    SELECT column1 AS question
    FROM VALUES ('Who is overdue on SpO2?'),
                ('Which drafts are waiting and why?'),
                ('What did the last threshold edit change?')
    WHERE column1 NOT IN (SELECT question FROM CARE_RULES.CORE.ASK_CACHE WHERE question IS NOT NULL);
BEGIN
  FOR rec IN todo DO
    q := rec.question;
    req := TO_JSON(OBJECT_CONSTRUCT('messages', ARRAY_CONSTRUCT(OBJECT_CONSTRUCT(
             'role', 'user',
             'content', ARRAY_CONSTRUCT(OBJECT_CONSTRUCT('type', 'text', 'text', q))))));
    SELECT SNOWFLAKE.CORTEX.DATA_AGENT_RUN('CARE_RULES.CORE.TETHER_ASK', :req) INTO :resp;

    -- Final text = the response's text items in order; SQL = the last system_execute_sql result.
    SELECT TO_JSON(OBJECT_CONSTRUCT_KEEP_NULL(
             'text', NULLIF(TRIM(ARRAY_TO_STRING(
                       ARRAY_AGG(IFF(c.value:type::VARCHAR = 'text', c.value:text::VARCHAR, NULL))
                         WITHIN GROUP (ORDER BY c.index), '\n\n'), ' \n'), ''),
             'sql', GET(ARRAY_AGG(IFF(c.value:tool_result:name::VARCHAR = 'system_execute_sql',
                                      c.value:tool_result:content[0]:json:sql::VARCHAR, NULL))
                          WITHIN GROUP (ORDER BY c.index DESC), 0)::VARCHAR,
             'model', ANY_VALUE(p.r:metadata:orchestration_model::VARCHAR),
             'status', ANY_VALUE(p.r:status::VARCHAR)))
      INTO :answer_json
      FROM (SELECT TRY_PARSE_JSON(:resp) AS r) p, LATERAL FLATTEN(input => p.r:content) c;

    INSERT INTO CARE_RULES.CORE.MODEL_CALLS (proc, model, input_text, output, ref_type, ref_id, ok)
      SELECT 'ASK_SEED', a:model::VARCHAR, :q, :answer_json, 'ASK_CACHE', :q, a:text IS NOT NULL
      FROM (SELECT PARSE_JSON(:answer_json) AS a);

    INSERT INTO CARE_RULES.CORE.ASK_CACHE (question, answer)
      SELECT :q, a FROM (SELECT PARSE_JSON(:answer_json) AS a) WHERE a:text IS NOT NULL;
    recorded := recorded + SQLROWCOUNT;
  END FOR;
  RETURN recorded || ' answers recorded';
END;
$$;

SELECT question, answer:model::VARCHAR AS model, LEFT(answer:text::VARCHAR, 160) AS answer_start,
       answer:sql IS NOT NULL AS has_sql, recorded_at
FROM ASK_CACHE
ORDER BY recorded_at DESC;
