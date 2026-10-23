-- =====================================================================
-- Tether drafts and simulated clock. Runs after sql/15_tether_tables.sql and
-- sql/42_tether_safety.sql (SAFETY_CHECK).
--   DRAFT_ACTIONS()        one PENDING ACTION_QUEUE draft per new row of Faiz's V_RULE_FIRINGS
--   TICK()                 = DRAFT_ACTIONS()
--   ADVANCE_CLOCK(p_days)  moves the simulated clock (AS_OF) forward, then TICK()
-- A clinician approves every outbound action: these procedures write PENDING drafts only. The one
-- exception is a red flag, which also writes the internal clinician alert (OUTBOX INTERNAL_ALERT).
-- No DDL inside the procedures, so tests can run them inside BEGIN ... ROLLBACK.
-- Idempotent: CREATE OR REPLACE ... COPY GRANTS.
-- =====================================================================
USE SCHEMA CARE_RULES.CORE;

-- One draft per firing; recipient NONE (HOLD) is never drafted. Kinds:
--   RED_FLAG     URGENT_ALERT: fixed text and the internal alert at once. Skipped only while an
--                open row exists for the same patient, condition and rule.
--   PLAN_REVIEW  PLAN-REVIEW: fixed text quoting the AI Plan line that was not applied.
--   DRAFT        everything else: Claude (TETHER_SETTINGS MODEL_DRAFTER) writes it, one call each.
-- Routine kinds (PLAN_REVIEW, DRAFT) are skipped while an open action (PENDING, APPROVED, EDITED)
-- exists for the patient and condition, and when the latest action for the patient and condition
-- has the same rule and was SENT or REJECTED (the next ladder rung has a new rule, so it still fires).
-- Claude sees the SYN id, the rule row, the evidence and the clinician's AI Plan preferences, with
-- every MEDICATIONS.drug_class replaced by "current medication". Each output must pass SAFETY_CHECK
-- and end with a "Why:" line; a failing draft is retried once with a stricter instruction, then
-- replaced by fixed template text (draft_source TEMPLATE). Prompts and outputs are staged once in
-- DRAFT_STAGE and copied from there to MODEL_CALLS and ACTION_QUEUE.
CREATE OR REPLACE PROCEDURE DRAFT_ACTIONS()
COPY GRANTS
RETURNS VARIANT
LANGUAGE SQL
COMMENT = 'Tether: PENDING drafts for new V_RULE_FIRINGS rows; a clinician approves every send'
EXECUTE AS OWNER
AS
$$
DECLARE
  v_run_id      VARCHAR DEFAULT UUID_STRING();
  v_run_ts      TIMESTAMP_NTZ;
  v_as_of       DATE;
  v_model       VARCHAR;
  v_params_ok   BOOLEAN DEFAULT FALSE;
  v_med_rx      VARCHAR;
  v_todo        ARRAY;
  v_n_held      INTEGER DEFAULT 0;
  v_n_skipped   INTEGER DEFAULT 0;
  v_n_backfill  INTEGER DEFAULT 0;
  v_n_draft     INTEGER DEFAULT 0;
  v_n_retry     INTEGER DEFAULT 0;
  v_n_created   INTEGER DEFAULT 0;
  v_n_red       INTEGER DEFAULT 0;
  v_n_plan      INTEGER DEFAULT 0;
  v_n_claude    INTEGER DEFAULT 0;
  v_n_template  INTEGER DEFAULT 0;
  v_ids         ARRAY DEFAULT ARRAY_CONSTRUCT();
BEGIN
  SELECT MAX(as_of_date) INTO :v_as_of FROM AS_OF;
  SELECT MAX(value) INTO :v_model FROM TETHER_SETTINGS WHERE key = 'MODEL_DRAFTER';
  IF (v_model IS NULL) THEN
    RETURN OBJECT_CONSTRUCT('ok', FALSE, 'message', 'TETHER_SETTINGS has no MODEL_DRAFTER row');
  END IF;
  -- model_parameters only for model ids whose logged probe accepted them
  SELECT COALESCE(BOOLOR_AGG(UPPER(value) = 'TRUE'), FALSE) INTO :v_params_ok
  FROM TETHER_SETTINGS
  WHERE key = 'MODEL_PARAMS_OK_' || UPPER(REPLACE(:v_model, '-', '_'));

  -- This run's rows are found again by created_at = v_run_ts, which is later than every existing row.
  SELECT GREATEST(CURRENT_TIMESTAMP()::TIMESTAMP_NTZ,
                  COALESCE(DATEADD('microsecond', 1, MAX(created_at)), '1970-01-01'::TIMESTAMP_NTZ))
  INTO :v_run_ts
  FROM ACTION_QUEUE;

  -- Rows written by Faiz's GENERATE_DRAFTS (when it succeeds) get ACTION_META and the same drug and
  -- dose check, so SEND_APPROVED can rule on them. Rows with a DRAFT_STAGE entry are Tether's own.
  INSERT INTO ACTION_META (action_id, run_id, kind, sim_date, layer, model, draft_source, safety_ok, safety_notes)
  SELECT q.action_id, :v_run_id,
         CASE WHEN r.action_type = 'URGENT_ALERT' THEN 'RED_FLAG'
              WHEN q.rule_id = 'PLAN-REVIEW' THEN 'PLAN_REVIEW'
              ELSE 'DRAFT' END,
         :v_as_of,
         IFF(q.rule_id IN ('HOLD', 'ENG-3H', 'PLAN-REVIEW'), 'P2', 'P0'),
         NULL, 'FAIZ',
         q.draft_text IS NOT NULL AND COALESCE(SAFETY_CHECK(q.draft_text):ok::BOOLEAN, FALSE),
         'Drafted by GENERATE_DRAFTS; drug and dose check run by DRAFT_ACTIONS'
  FROM ACTION_QUEUE q
  JOIN RULES r ON r.rule_id = q.rule_id
  WHERE NOT EXISTS (SELECT 1 FROM ACTION_META m WHERE m.action_id = q.action_id)
    AND NOT EXISTS (SELECT 1 FROM DRAFT_STAGE s
                    WHERE s.patient_id = q.patient_id AND s.condition = q.condition AND s.rule_id = q.rule_id);
  v_n_backfill := SQLROWCOUNT;

  -- Medication classes as one case-insensitive pattern; punctuation is wrapped in [ ].
  SELECT NULLIF(LISTAGG(REGEXP_REPLACE(drug_class, '([]/().+*?|${}[-])', '[\\1]'), '|')
                  WITHIN GROUP (ORDER BY LENGTH(drug_class) DESC, drug_class), '')
  INTO :v_med_rx
  FROM (SELECT DISTINCT TRIM(drug_class) AS drug_class
        FROM MEDICATIONS
        WHERE drug_class IS NOT NULL AND TRIM(drug_class) <> '');

  -- Snapshot of the firings to draft, with prompt and fixed texts, read once for the whole run.
  SELECT ARRAY_AGG(IFF(x.draftable, OBJECT_CONSTRUCT(
           'patient_id', x.patient_id, 'condition', x.condition, 'rule_id', x.rule_id,
           'recipient', x.recipient, 'evidence', x.evidence, 'patient_prefs', x.patient_prefs,
           'kind', x.kind, 'layer', x.layer, 'language', x.language,
           'prompt', x.prompt, 'rule_text', x.rule_text,
           'template_text', x.template_text, 'template_note', x.template_note), NULL))
           WITHIN GROUP (ORDER BY x.priority, x.patient_id, x.condition),
         COUNT_IF(x.recipient = 'NONE'),
         COUNT_IF(x.recipient <> 'NONE' AND NOT x.draftable)
  INTO :v_todo, :v_n_held, :v_n_skipped
  FROM (
    WITH f0 AS (
      SELECT v.patient_id, v.condition, v.rule_id, v.step, v.action_type,
             COALESCE(v.recipient, 'NONE') AS recipient, v.priority, v.evidence, v.citation,
             v.patient_prefs,
             CASE WHEN v.action_type = 'URGENT_ALERT' THEN 'RED_FLAG'
                  WHEN v.rule_id = 'PLAN-REVIEW' OR v.action_type = 'PLAN_REVIEW' THEN 'PLAN_REVIEW'
                  ELSE 'DRAFT' END AS kind
      FROM V_RULE_FIRINGS v
    ),
    ov AS (   -- applied AI Plan settings per patient (latest signed line wins)
      SELECT patient_id,
             BOOLOR_AGG(setting = 'BP_GOAL')               AS has_bp_goal,
             BOOLOR_AGG(setting = 'A1C_GOAL')              AS has_a1c_goal,
             MAX(IFF(setting = 'LANGUAGE', raw_value, NULL)) AS language
      FROM V_ACTIVE_OVERRIDES
      GROUP BY patient_id
    ),
    open_pc AS (    -- open actions per patient x condition
      SELECT patient_id, condition, COUNT(*) AS n
      FROM ACTION_QUEUE WHERE status IN ('PENDING', 'APPROVED', 'EDITED')
      GROUP BY patient_id, condition
    ),
    open_pcr AS (   -- open actions per patient x condition x rule
      SELECT patient_id, condition, rule_id, COUNT(*) AS n
      FROM ACTION_QUEUE WHERE status IN ('PENDING', 'APPROVED', 'EDITED')
      GROUP BY patient_id, condition, rule_id
    ),
    latest AS (     -- latest action per patient x condition
      SELECT patient_id, condition, rule_id, status
      FROM ACTION_QUEUE
      QUALIFY ROW_NUMBER() OVER (PARTITION BY patient_id, condition ORDER BY created_at DESC, action_id DESC) = 1
    ),
    f AS (
      SELECT f0.*,
             CASE WHEN f0.rule_id IN ('HOLD', 'ENG-3H', 'PLAN-REVIEW') THEN 'P2'
                  WHEN f0.rule_id IN ('BP-1', 'BP-3') AND COALESCE(ov.has_bp_goal, FALSE) THEN 'P2'
                  WHEN f0.rule_id IN ('DM-1', 'DM-2') AND COALESCE(ov.has_a1c_goal, FALSE) THEN 'P2'
                  ELSE 'P0' END AS layer,
             COALESCE(ov.language, 'English') AS language,
             IFF(:v_med_rx IS NULL, f0.evidence,
                 REGEXP_REPLACE(f0.evidence, :v_med_rx, 'current medication', 1, 0, 'i')) AS evidence_clean,
             IFF(:v_med_rx IS NULL, f0.patient_prefs,
                 REGEXP_REPLACE(f0.patient_prefs, :v_med_rx, 'current medication', 1, 0, 'i')) AS prefs_clean,
             CASE f0.condition WHEN 'HTN' THEN 'blood pressure'
                               WHEN 'COPD' THEN 'oxygen level (SpO2)'
                               WHEN 'T2DM' THEN 'blood sugar'
                               ELSE 'home' END AS reading_word,
             pp.display_name,
             f0.recipient <> 'NONE'
               AND CASE WHEN f0.kind = 'RED_FLAG' THEN opr.n IS NULL
                        ELSE op.n IS NULL
                             AND NOT COALESCE(l.rule_id = f0.rule_id AND l.status IN ('SENT', 'REJECTED'), FALSE)
                   END AS draftable
      FROM f0
      LEFT JOIN ov              ON ov.patient_id = f0.patient_id
      LEFT JOIN PATIENT_PROFILE pp ON pp.patient_id = f0.patient_id
      LEFT JOIN open_pc op      ON op.patient_id = f0.patient_id AND op.condition = f0.condition
      LEFT JOIN open_pcr opr    ON opr.patient_id = f0.patient_id AND opr.condition = f0.condition
                               AND opr.rule_id = f0.rule_id
      LEFT JOIN latest l        ON l.patient_id = f0.patient_id AND l.condition = f0.condition
    ),
    p AS (
      SELECT f.*,
        'You write one draft message for a care team. A clinician reviews and approves every draft before anything is sent.'
        || ' Rules: Do not diagnose. Do not name any medicine, drug, drug class or dose; refer only to the guideline step,'
        || ' and say "current medication" if treatment must be mentioned.'
        || ' Use only the facts below; do not add numbers, dates, names or advice that are not in the facts.'
        || ' The patient is identified only as ' || f.patient_id || ' (synthetic test patient); never invent a name. '
        || CASE
             WHEN f.action_type = 'AI_CHECKIN_CALL' THEN
               'Write an approval request to the clinician for one automated AI check-in call to this patient'
               || ' (simulated in this prototype; no real call is placed). Say what the call will do: say first that it is'
               || ' an automated AI assistant calling for the care team, confirm two identifiers, ask for a '
               || f.reading_word || ' reading today, ask what gets in the way and the adherence questions, and offer'
               || ' reminder times. Say that it only collects information, gives no advice, and hands off to a person at'
               || ' once on any symptom, red-flag reading, medical question or request for a person. Note that consent to'
               || ' automated calls must be on file. If the preferences give a language, say the call will be in that language.'
             WHEN f.action_type = 'CARE_TEAM_CALL' THEN
               'Write a short call brief for a care team member who will phone the patient; the clinician asked for a'
               || ' person, not an AI call. Say why the call is needed, what to ask (a ' || f.reading_word
               || ' reading today, what gets in the way, preferred reminder times) and when to call, using the'
               || ' preferences. Address the caller, not the patient. Write in English.'
             WHEN f.recipient = 'PATIENT' THEN
               'Write to the patient as a short text message: warm and calm, plain words at a grade 6 reading level,'
               || ' with no name and no patient token in the message. Give exactly one instruction. Tell the patient how'
               || ' to reach a person: reply to this message or call the clinic. Write the message in ' || f.language
               || '; keep only the Why: line in English.'
             ELSE
               'Write to the ' || LOWER(f.recipient) || ' in a brief, professional clinical tone. State the evidence and'
               || ' name the guideline step only; the clinician or prescriber decides any treatment.'
               || IFF(f.action_type = 'RECOMMEND_O2_EVAL',
                      ' Ask for an oxygen evaluation only; do not suggest any inhaler or medication change.', '')
               || ' Write in English. If the preferences give a language other than English, add one short sentence'
               || ' noting that patient messages should be in that language.'
           END
        || ' Write at most 90 words, then one final line in English that starts with "Why:" and cites rule '
        || f.rule_id || ' and the guideline.'
        || ' Plain text only: no markdown, headings, labels or quotation marks around the draft.'
        || ' Facts: Condition: ' || f.condition || '. Action: ' || f.action_type || '. Recipient: ' || f.recipient || '.'
        || ' Rule: ' || f.rule_id || ' (' || COALESCE(f.step, '') || '). Guideline: ' || COALESCE(f.citation, '') || '.'
        || ' Evidence: ' || COALESCE(f.evidence_clean, 'none') || '.'
        || ' Clinician preferences for this patient (follow them): ' || COALESCE(f.prefs_clean, 'none') || '.'
          AS prompt_raw,
        CASE f.kind
          WHEN 'RED_FLAG' THEN
            'Urgent: ' || COALESCE(f.evidence_clean, '') || '. Rule ' || f.rule_id
            || ' (' || COALESCE(f.citation, '') || '). Review now.'
          WHEN 'PLAN_REVIEW' THEN
            'Not applied: ' || COALESCE(f.evidence_clean, '') || '. Please review this AI Plan line.'
            || CHAR(10) || 'Why: Rule ' || f.rule_id || ' (' || COALESCE(f.citation, '') || ').'
        END AS rule_text,
        CASE
          WHEN f.action_type = 'AI_CHECKIN_CALL' THEN
            'Approval request: one automated AI check-in call to ' || f.patient_id || ' (simulated; no real call is placed).'
            || ' The call says first that it is an AI assistant for the care team, confirms two identifiers, asks for a '
            || f.reading_word || ' reading today, asks what gets in the way and the adherence questions, and offers'
            || ' reminder times. It gives no advice and hands off to a person on any symptom, red-flag reading, question'
            || ' or request. Consent to automated calls must be on file. Evidence: ' || COALESCE(f.evidence_clean, '') || '.'
          WHEN f.action_type = 'CARE_TEAM_CALL' THEN
            'Call brief: please phone ' || f.patient_id || '; the clinician asked for a person, not an AI call.'
            || ' Evidence: ' || COALESCE(f.evidence_clean, '') || '. Ask for a ' || f.reading_word
            || ' reading today, what gets in the way, and preferred reminder times.'
            || IFF(f.prefs_clean IS NULL, '', ' Preferences: ' || f.prefs_clean || '.')
          WHEN f.recipient = 'PATIENT' THEN
            'Hello from your care team. '
            || CASE f.action_type
                 WHEN 'READING_REMINDER' THEN
                   'We have not received your home ' || f.reading_word || ' reading lately. Please take one today and log it.'
                 WHEN 'BARRIER_CHECKIN' THEN
                   'We have not received your home ' || f.reading_word || ' readings. Please reply and tell us what gets'
                   || ' in the way: no working device, forgetting, not sure how to measure, or cost.'
                 WHEN 'ADHERENCE_CHECKIN' THEN
                   'Please reply and tell us how your current medication is going, including any missed doses or side effects.'
                 WHEN 'LAB_REMINDER' THEN
                   'Your ' || IFF(f.condition = 'T2DM', 'A1C lab test', 'lab test') || ' is due. Please book a lab visit.'
                 ELSE 'Please reply to this message so we can follow up.'
               END
            || ' To talk with a person, reply to this message or call the clinic.'
          ELSE
            'For review: ' || f.patient_id || ' (' || f.condition || '). ' || COALESCE(f.evidence_clean, '')
            || '. Guideline step: ' || COALESCE(f.step, '') || '. The clinician or prescriber decides any treatment.'
            || IFF(f.language <> 'English', ' Patient messages should be in ' || f.language || '.', '')
        END
        || CHAR(10) || 'Why: Rule ' || f.rule_id || ' (' || COALESCE(f.step, '') || '); ' || COALESCE(f.citation, '') || '.'
          AS template_text,
        IFF(f.recipient = 'PATIENT' AND f.action_type <> 'AI_CHECKIN_CALL' AND f.language <> 'English',
            'Template is in English; language preference ' || f.language || ' not applied', NULL) AS template_note
      FROM f
    )
    SELECT p.*,
           -- defense in depth: a display name never reaches the model
           IFF(p.kind <> 'DRAFT', NULL,
               IFF(COALESCE(p.display_name, '') = '', p.prompt_raw,
                   REPLACE(p.prompt_raw, p.display_name, p.patient_id))) AS prompt
    FROM p
  ) x;

  INSERT INTO DRAFT_STAGE (run_id, patient_id, condition, rule_id, kind, prompt, output, ok, safety_ok,
                           safety_notes, source, model)
  SELECT :v_run_id, t.value:patient_id::VARCHAR, t.value:condition::VARCHAR, t.value:rule_id::VARCHAR,
         t.value:kind::VARCHAR,
         t.value:prompt::VARCHAR,
         t.value:rule_text::VARCHAR,
         NULL,
         IFF(t.value:kind::VARCHAR = 'DRAFT', NULL, SAFETY_CHECK(t.value:rule_text::VARCHAR):ok::BOOLEAN),
         NULL,
         IFF(t.value:kind::VARCHAR = 'DRAFT', NULL, 'RULE'),
         IFF(t.value:kind::VARCHAR = 'DRAFT', :v_model, NULL)
  FROM TABLE(FLATTEN(input => :v_todo)) t;

  SELECT COUNT(*) INTO :v_n_draft FROM DRAFT_STAGE WHERE run_id = :v_run_id AND kind = 'DRAFT';

  IF (v_n_draft > 0) THEN
    -- Attempt 1: one set-based call; a NULL output is a failed call.
    IF (v_params_ok) THEN
      UPDATE DRAFT_STAGE
      SET output = AI_COMPLETE(model => :v_model, prompt => prompt, model_parameters => {'temperature': 0})::VARCHAR
      WHERE run_id = :v_run_id AND kind = 'DRAFT';
    ELSE
      UPDATE DRAFT_STAGE
      SET output = AI_COMPLETE(model => :v_model, prompt => prompt)::VARCHAR
      WHERE run_id = :v_run_id AND kind = 'DRAFT';
    END IF;

    UPDATE DRAFT_STAGE
    SET ok = (output IS NOT NULL AND TRIM(output) <> ''),
        safety_ok = SAFETY_CHECK(output):ok::BOOLEAN,
        safety_notes = CASE
          WHEN output IS NULL OR TRIM(output) = '' THEN 'Attempt 1: the model returned no text'
          WHEN NOT SAFETY_CHECK(output):ok::BOOLEAN
            THEN 'Attempt 1: named ' || ARRAY_TO_STRING(SAFETY_CHECK(output):hits, ', ')
          WHEN NOT CONTAINS(output, 'Why:') THEN 'Attempt 1: no Why: line'
        END
    WHERE run_id = :v_run_id AND kind = 'DRAFT';

    INSERT INTO MODEL_CALLS (proc, model, input_text, output, ref_type, ref_id, patient_id, ok)
    SELECT 'DRAFT_ACTIONS', model, prompt, output, 'DRAFT_STAGE',
           run_id || ':' || patient_id || ':' || condition || ':' || rule_id || ':1', patient_id, ok
    FROM DRAFT_STAGE
    WHERE run_id = :v_run_id AND kind = 'DRAFT';

    SELECT COUNT(*) INTO :v_n_retry
    FROM DRAFT_STAGE WHERE run_id = :v_run_id AND kind = 'DRAFT' AND safety_notes IS NOT NULL;

    IF (v_n_retry > 0) THEN
      -- Attempt 2, failing rows only, with a stricter instruction.
      UPDATE DRAFT_STAGE
      SET prompt = prompt || ' IMPORTANT: your previous draft was rejected ('
                   || REPLACE(safety_notes, 'Attempt 1: ', '') || '). Write it again. Never mention any medicine,'
                   || ' drug name, drug class or an amount with a unit (mg, mcg, ml, units, puffs, tablets); say'
                   || ' "current medication" or name the guideline step instead. End with one line that starts with "Why:".',
          output = NULL,
          source = 'RETRY'
      WHERE run_id = :v_run_id AND kind = 'DRAFT' AND safety_notes IS NOT NULL;

      IF (v_params_ok) THEN
        UPDATE DRAFT_STAGE
        SET output = AI_COMPLETE(model => :v_model, prompt => prompt, model_parameters => {'temperature': 0})::VARCHAR
        WHERE run_id = :v_run_id AND kind = 'DRAFT' AND source = 'RETRY';
      ELSE
        UPDATE DRAFT_STAGE
        SET output = AI_COMPLETE(model => :v_model, prompt => prompt)::VARCHAR
        WHERE run_id = :v_run_id AND kind = 'DRAFT' AND source = 'RETRY';
      END IF;

      UPDATE DRAFT_STAGE
      SET ok = (output IS NOT NULL AND TRIM(output) <> ''),
          safety_ok = SAFETY_CHECK(output):ok::BOOLEAN,
          safety_notes = safety_notes || '; attempt 2: ' || CASE
            WHEN output IS NULL OR TRIM(output) = '' THEN 'the model returned no text'
            WHEN NOT SAFETY_CHECK(output):ok::BOOLEAN
              THEN 'named ' || ARRAY_TO_STRING(SAFETY_CHECK(output):hits, ', ')
            WHEN NOT CONTAINS(output, 'Why:') THEN 'no Why: line'
            ELSE 'passed'
          END
      WHERE run_id = :v_run_id AND kind = 'DRAFT' AND source = 'RETRY';

      INSERT INTO MODEL_CALLS (proc, model, input_text, output, ref_type, ref_id, patient_id, ok)
      SELECT 'DRAFT_ACTIONS', model, prompt, output, 'DRAFT_STAGE',
             run_id || ':' || patient_id || ':' || condition || ':' || rule_id || ':2', patient_id, ok
      FROM DRAFT_STAGE
      WHERE run_id = :v_run_id AND kind = 'DRAFT' AND source = 'RETRY';
    END IF;

    UPDATE DRAFT_STAGE
    SET source = IFF(ok AND safety_ok AND CONTAINS(output, 'Why:'), 'CLAUDE', 'TEMPLATE')
    WHERE run_id = :v_run_id AND kind = 'DRAFT';
  END IF;

  INSERT INTO ACTION_QUEUE (patient_id, condition, rule_id, recipient, evidence, patient_prefs, draft_text, created_at)
  SELECT s.patient_id, s.condition, s.rule_id,
         t.value:recipient::VARCHAR, t.value:evidence::VARCHAR, t.value:patient_prefs::VARCHAR,
         CASE s.source WHEN 'CLAUDE'   THEN TRIM(REPLACE(s.output, '**', ''))
                       WHEN 'TEMPLATE' THEN t.value:template_text::VARCHAR
                       ELSE s.output END,
         :v_run_ts
  FROM DRAFT_STAGE s
  JOIN TABLE(FLATTEN(input => :v_todo)) t
    ON t.value:patient_id::VARCHAR = s.patient_id AND t.value:condition::VARCHAR = s.condition
   AND t.value:rule_id::VARCHAR = s.rule_id
  WHERE s.run_id = :v_run_id;
  v_n_created := SQLROWCOUNT;

  IF (v_n_created > 0) THEN
    INSERT INTO ACTION_META (action_id, run_id, kind, sim_date, layer, model, draft_source, safety_ok,
                             safety_notes, call_id)
    SELECT q.action_id, :v_run_id, s.kind, :v_as_of, t.value:layer::VARCHAR,
           IFF(s.source = 'CLAUDE', s.model, NULL),
           s.source,
           COALESCE(SAFETY_CHECK(q.draft_text):ok::BOOLEAN, FALSE) AND q.draft_text IS NOT NULL,
           ARRAY_TO_STRING(ARRAY_CONSTRUCT_COMPACT(   -- NULL parts are dropped
             CASE s.source WHEN 'RULE' THEN 'Rule text, no model'
                           WHEN 'CLAUDE' THEN COALESCE(s.safety_notes, 'Passed the drug and dose check')
                           ELSE COALESCE(s.safety_notes, 'Model draft not used') || '; template text used' END,
             IFF(s.source = 'TEMPLATE', t.value:template_note::VARCHAR, NULL),
             IFF(COALESCE(SAFETY_CHECK(q.draft_text):ok::BOOLEAN, FALSE), NULL,
                 'final text failed the check: ' || ARRAY_TO_STRING(SAFETY_CHECK(q.draft_text):hits, ', '))), '; '),
           mc.call_id
    FROM ACTION_QUEUE q
    JOIN DRAFT_STAGE s
      ON s.run_id = :v_run_id AND s.patient_id = q.patient_id AND s.condition = q.condition AND s.rule_id = q.rule_id
    JOIN TABLE(FLATTEN(input => :v_todo)) t
      ON t.value:patient_id::VARCHAR = s.patient_id AND t.value:condition::VARCHAR = s.condition
     AND t.value:rule_id::VARCHAR = s.rule_id
    LEFT JOIN MODEL_CALLS mc
      ON s.kind = 'DRAFT' AND mc.ref_type = 'DRAFT_STAGE'
     AND mc.ref_id = s.run_id || ':' || s.patient_id || ':' || s.condition || ':' || s.rule_id || ':'
                     || IFF(s.safety_notes LIKE 'Attempt 1:%', '2', '1')
    WHERE q.created_at = :v_run_ts;

    -- Red flags: the internal clinician alert goes out at once (the only send without approval).
    INSERT INTO OUTBOX (action_id, channel, recipient, patient_id, payload, provider, sent_sim)
    SELECT q.action_id, 'INTERNAL_ALERT', q.recipient, q.patient_id, q.patient_id || ' · ' || q.draft_text,
           'simulated', :v_as_of
    FROM ACTION_QUEUE q
    JOIN ACTION_META m ON m.action_id = q.action_id AND m.run_id = :v_run_id
    WHERE q.created_at = :v_run_ts AND m.kind = 'RED_FLAG';

    INSERT INTO AUDIT_LOG (actor, event, action_id, detail)
    SELECT 'CARE_AGENT_ROLE',
           IFF(m.kind = 'RED_FLAG', 'RED_FLAG_ALERT', 'DRAFT_CREATED'),
           q.action_id,
           q.patient_id || ' · ' || q.rule_id || ' · ' ||
           CASE m.kind
             WHEN 'RED_FLAG' THEN 'urgent internal alert to the clinician (simulated): ' || COALESCE(q.evidence, '')
             WHEN 'PLAN_REVIEW' THEN 'AI Plan line queued for clinician review (rule text)'
             ELSE IFF(m.draft_source = 'CLAUDE', 'draft by ' || m.model,
                      'template draft (the model draft did not pass the checks)')
                  || ', waiting for clinician approval'
           END
    FROM ACTION_QUEUE q
    JOIN ACTION_META m ON m.action_id = q.action_id AND m.run_id = :v_run_id
    WHERE q.created_at = :v_run_ts;

    SELECT COUNT_IF(m.kind = 'RED_FLAG'), COUNT_IF(m.kind = 'PLAN_REVIEW'),
           COUNT_IF(m.draft_source = 'CLAUDE'), COUNT_IF(m.draft_source = 'TEMPLATE'),
           ARRAY_AGG(q.action_id) WITHIN GROUP (ORDER BY q.action_id)
    INTO :v_n_red, :v_n_plan, :v_n_claude, :v_n_template, :v_ids
    FROM ACTION_QUEUE q
    JOIN ACTION_META m ON m.action_id = q.action_id AND m.run_id = :v_run_id
    WHERE q.created_at = :v_run_ts;
  END IF;

  INSERT INTO AUDIT_LOG (actor, event, detail)
  VALUES ('CARE_AGENT_ROLE', 'DRAFTS_GENERATED',
          :v_n_created || ' drafts (' || :v_n_red || ' red-flag alerts, ' || :v_n_plan || ' plan reviews, '
          || :v_n_claude || ' by ' || :v_model || ', ' || :v_n_template || ' templates); '
          || (:v_n_draft + :v_n_retry) || ' model calls; ' || :v_n_skipped || ' firings already open or handled, '
          || :v_n_held || ' held; ' || :v_n_backfill || ' GENERATE_DRAFTS rows checked; sim date '
          || TO_VARCHAR(:v_as_of, 'YYYY-MM-DD') || ' (simulated); run ' || :v_run_id);

  RETURN OBJECT_CONSTRUCT(
    'ok', TRUE, 'run_id', v_run_id, 'as_of', TO_VARCHAR(v_as_of, 'YYYY-MM-DD'), 'model', v_model,
    'created', v_n_created, 'red_flags', v_n_red, 'plan_reviews', v_n_plan, 'claude_drafts', v_n_claude,
    'templates', v_n_template, 'model_calls', v_n_draft + v_n_retry, 'retried', v_n_retry,
    'skipped', v_n_skipped, 'held', v_n_held, 'backfilled', v_n_backfill, 'action_ids', v_ids);
EXCEPTION
  WHEN OTHER THEN
    INSERT INTO AUDIT_LOG (actor, event, detail)
    VALUES ('CARE_AGENT_ROLE', 'DRAFTS_FAILED', 'Run ' || :v_run_id || ' failed: ' || :sqlerrm);
    RETURN OBJECT_CONSTRUCT('ok', FALSE, 'run_id', v_run_id, 'message', sqlerrm,
                            'sqlcode', sqlcode, 'sqlstate', sqlstate);
END;
$$;

-- One evaluation step of the simulated clock.
CREATE OR REPLACE PROCEDURE TICK()
COPY GRANTS
RETURNS VARIANT
LANGUAGE SQL
COMMENT = 'Tether: draft the next steps for the current simulated date (= DRAFT_ACTIONS)'
EXECUTE AS OWNER
AS
$$
DECLARE
  v_res VARIANT;
BEGIN
  CALL DRAFT_ACTIONS() INTO :v_res;
  RETURN v_res;
END;
$$;

-- Moves the simulated clock (AS_OF) forward by p_days (1 to 60), then runs TICK.
-- p_days = 0 jumps to the next follow-up ladder event: the fewest days until a monitored home reading
-- (V_MONITORED_VALUES, not paused) reaches the next ENG-* threshold in RULES. Falls back to 1 day
-- when V_MONITORED_VALUES does not exist yet or no rung is ahead.
CREATE OR REPLACE PROCEDURE ADVANCE_CLOCK(p_days INTEGER)
COPY GRANTS
RETURNS VARIANT
LANGUAGE SQL
COMMENT = 'Tether: advance the simulated clock (AS_OF), then TICK'
EXECUTE AS OWNER
AS
$$
DECLARE
  v_days     INTEGER;
  v_mode     VARCHAR DEFAULT 'fixed';
  v_before   DATE;
  v_after    DATE;
  v_tick     VARIANT;
BEGIN
  IF (p_days IS NULL OR p_days < 0 OR p_days > 60) THEN
    RETURN OBJECT_CONSTRUCT('ok', FALSE, 'message', 'Days must be 0 (next event) or 1 to 60');
  END IF;
  v_days := p_days;
  IF (p_days = 0) THEN
    v_mode := 'next event';
    BEGIN
      SELECT MIN(r.threshold1 - v.days_overdue)::INTEGER INTO :v_days
      FROM V_MONITORED_VALUES v
      JOIN RULES r
        ON r.rule_id LIKE 'ENG-%' AND r.threshold1 IS NOT NULL AND r.threshold1 > v.days_overdue
      WHERE v.reading_type IN ('BP', 'SPO2', 'GLUCOSE')
        AND v.days_overdue IS NOT NULL
        AND NOT COALESCE(v.paused, FALSE);
    EXCEPTION
      WHEN OTHER THEN
        v_days := NULL;
    END;
    IF (v_days IS NULL OR v_days < 1) THEN
      v_days := 1;
      v_mode := 'next event not found; 1 day';
    END IF;
    IF (v_days > 60) THEN
      v_days := 60;
    END IF;
  END IF;

  SELECT MAX(as_of_date) INTO :v_before FROM AS_OF;
  UPDATE AS_OF SET as_of_date = DATEADD('day', :v_days, as_of_date);
  SELECT MAX(as_of_date) INTO :v_after FROM AS_OF;
  INSERT INTO AUDIT_LOG (actor, event, detail)
  VALUES ('SIMULATED_CLOCK', 'CLOCK_ADVANCED',
          TO_VARCHAR(:v_before, 'YYYY-MM-DD') || ' -> ' || TO_VARCHAR(:v_after, 'YYYY-MM-DD') || ' (simulated)');

  CALL TICK() INTO :v_tick;
  RETURN OBJECT_CONSTRUCT(
    'ok', COALESCE(v_tick:ok::BOOLEAN, FALSE), 'clock_advanced', TRUE, 'days', v_days, 'mode', v_mode,
    'as_of_before', TO_VARCHAR(v_before, 'YYYY-MM-DD'), 'as_of_after', TO_VARCHAR(v_after, 'YYYY-MM-DD'),
    'tick', v_tick);
END;
$$;
