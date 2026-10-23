-- =====================================================================
-- Tether approval gate, simulated sends and simulated AI check-in calls.
-- Runs after Faiz's sql/care_rules_snowflake.sql (REVIEW_ACTION, V_READY_TO_SEND),
-- sql/10_tether_profile.sql, sql/15_tether_tables.sql and sql/42_tether_safety.sql (SAFETY_CHECK).
--
-- Every procedure runs with owner's rights. Who may call it is decided only by USAGE grants
-- (sql/55_tether_grants.sql): only CLINICIAN_ROLE can review or send. Audit rows carry
-- CURRENT_USER() as actor and constant role labels in the detail; patient-scoped details start
-- with the SYN id.
-- Every adapter is simulated: OUTBOX rows have provider 'simulated' and no message or call leaves
-- Snowflake. The procedures contain no DDL, so tests can run them inside BEGIN ... ROLLBACK.
-- Idempotent: CREATE OR REPLACE ... COPY GRANTS.
-- =====================================================================
USE SCHEMA CARE_RULES.CORE;

-- ---------------------------------------------------------------------
-- SEND_APPROVED(action_id): sends approved or edited drafts. Reads only V_READY_TO_SEND;
-- NULL sends every ready row. A row is sent only when it has an ACTION_META row whose drug and
-- dose post-check passed and its final text passes SAFETY_CHECK again.
-- Channels: red-flag alert or call handoff -> already alerted when raised (status SENT, no new
-- OUTBOX row); AI check-in call -> AI_CALL; other patient messages -> SMS; prescriber ->
-- PRESCRIBER; clinician -> CLINICIAN.
-- ---------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE SEND_APPROVED(p_action_id NUMBER)
COPY GRANTS
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS OWNER
AS
$$
DECLARE
  v_ids ARRAY;
  v_results ARRAY DEFAULT ARRAY_CONSTRUCT();
  v_sent INTEGER DEFAULT 0;
  v_asof DATE;
  v_id NUMBER;
  v_n INTEGER;
  v_pid VARCHAR;
  v_rule VARCHAR;
  v_recipient VARCHAR;
  v_text VARCHAR;
  v_action_type VARCHAR;
  v_meta_n INTEGER;
  v_kind VARCHAR;
  v_safety_ok BOOLEAN;
  v_check VARIANT;
  v_red BOOLEAN;
  v_channel VARCHAR;
  v_msg_id VARCHAR;
  v_detail VARCHAR;
  v_result VARIANT;
BEGIN
  SELECT MAX(as_of_date) INTO :v_asof FROM AS_OF;
  IF (p_action_id IS NULL) THEN
    SELECT COALESCE(ARRAY_AGG(action_id) WITHIN GROUP (ORDER BY action_id), ARRAY_CONSTRUCT())
      INTO :v_ids FROM V_READY_TO_SEND;
  ELSE
    v_ids := ARRAY_CONSTRUCT(p_action_id);
  END IF;

  IF (ARRAY_SIZE(v_ids) > 0) THEN
    FOR i IN 1 TO ARRAY_SIZE(v_ids) DO
      v_id := GET(v_ids, i - 1)::NUMBER;
      SELECT COUNT(*), MAX(patient_id), MAX(rule_id), MAX(recipient), MAX(draft_text)
        INTO :v_n, :v_pid, :v_rule, :v_recipient, :v_text
        FROM V_READY_TO_SEND WHERE action_id = :v_id;
      SELECT COUNT(*), MAX(kind), BOOLAND_AGG(COALESCE(safety_ok, FALSE))
        INTO :v_meta_n, :v_kind, :v_safety_ok
        FROM ACTION_META WHERE action_id = :v_id;
      SELECT MAX(action_type) INTO :v_action_type FROM RULES WHERE rule_id = :v_rule;
      SELECT SAFETY_CHECK(:v_text) INTO :v_check;

      IF (v_n = 0) THEN
        v_result := OBJECT_CONSTRUCT_KEEP_NULL('ok', FALSE, 'action_id', v_id, 'code', 'NOT_READY',
          'message', 'Action ' || v_id || ' is not approved or edited, so it is not sent.');
      ELSEIF (v_meta_n = 0) THEN
        v_result := OBJECT_CONSTRUCT_KEEP_NULL('ok', FALSE, 'action_id', v_id, 'code', 'NO_DRAFT_RECORD',
          'message', 'Action ' || v_id || ' has no Tether draft record (ACTION_META), so it is not sent.');
      ELSEIF (NOT v_safety_ok OR NOT GET(v_check, 'ok')::BOOLEAN) THEN
        v_result := OBJECT_CONSTRUCT_KEEP_NULL('ok', FALSE, 'action_id', v_id, 'code', 'SAFETY',
          'hits', GET(v_check, 'hits'),
          'message', 'Action ' || v_id || ' names a drug or a dose, so it is not sent. '
                     || 'Edit it to name the guideline step only.');
      ELSE
        v_red := COALESCE(v_action_type = 'URGENT_ALERT', FALSE)
                 OR COALESCE(v_kind IN ('RED_FLAG', 'CALL_HANDOFF'), FALSE);
        v_channel := CASE
                       WHEN v_red THEN 'INTERNAL_ALERT'
                       WHEN v_action_type = 'AI_CHECKIN_CALL' AND v_recipient = 'PATIENT' THEN 'AI_CALL'
                       WHEN v_recipient = 'PATIENT' THEN 'SMS'
                       WHEN v_recipient IN ('PRESCRIBER', 'PHARMACY') THEN v_recipient
                       ELSE 'CLINICIAN'
                     END;
        UPDATE ACTION_QUEUE SET status = 'SENT'
         WHERE action_id = :v_id AND status IN ('APPROVED', 'EDITED');
        IF (SQLROWCOUNT = 1) THEN
          v_msg_id := NULL;
          IF (NOT v_red) THEN
            v_msg_id := UUID_STRING();
            INSERT INTO OUTBOX (msg_id, action_id, channel, recipient, patient_id, payload, provider, sent_sim)
              SELECT :v_msg_id, :v_id, :v_channel, :v_recipient, :v_pid, :v_text, 'simulated', :v_asof;
            v_detail := v_pid || ' · ' || v_channel || ' to ' || v_recipient || ' · simulated adapter · sim date ' || v_asof;
          ELSE
            v_detail := v_pid || ' · red-flag alert acknowledged; the internal alert went to the clinician when it was raised';
          END IF;
          INSERT INTO AUDIT_LOG (actor, event, action_id, detail)
            SELECT CURRENT_USER(), 'SENT', :v_id, :v_detail;
          v_sent := v_sent + 1;
          v_result := OBJECT_CONSTRUCT_KEEP_NULL('ok', TRUE, 'action_id', v_id, 'status', 'SENT',
            'channel', v_channel, 'outbox', NOT v_red, 'msg_id', v_msg_id, 'sent_sim', v_asof::VARCHAR,
            'message', IFF(v_red, 'Red-flag alert acknowledged (no new message)',
                           'Sent by ' || v_channel || ' (simulated)'));
        ELSE
          v_result := OBJECT_CONSTRUCT_KEEP_NULL('ok', FALSE, 'action_id', v_id, 'code', 'CHANGED',
            'message', 'Action ' || v_id || ' changed before it was sent; nothing was sent.');
        END IF;
      END IF;
      v_results := ARRAY_APPEND(v_results, v_result);
    END FOR;
  END IF;

  IF (p_action_id IS NOT NULL) THEN
    RETURN GET(v_results, 0);
  END IF;
  RETURN OBJECT_CONSTRUCT_KEEP_NULL('ok', TRUE, 'count', ARRAY_SIZE(v_results), 'sent', v_sent,
    'results', v_results);
END;
$$;

-- ---------------------------------------------------------------------
-- TETHER_REVIEW(action_id, decision, note, edited_text, approver): the clinician's decision on a
-- PENDING draft, then the send if approved. Checks made before Faiz's REVIEW_ACTION:
-- decision APPROVED | EDITED | REJECTED; the row is PENDING; a rejection has a reason of at least
-- 10 characters; edited text is non-empty and passes SAFETY_CHECK; an approval has a Tether draft
-- record whose post-check passed. Edited text reaches REVIEW_ACTION only for EDITED. The status
-- is read again afterwards to confirm the decision applied.
-- p_approver is a display label for the audit row, not an access check: only CLINICIAN_ROLE has
-- USAGE on this procedure, so the audit detail names that role.
-- ---------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE TETHER_REVIEW(p_action_id NUMBER, p_decision VARCHAR, p_note VARCHAR,
                                          p_edited_text VARCHAR, p_approver VARCHAR)
COPY GRANTS
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS OWNER
AS
$$
DECLARE
  v_decision VARCHAR;
  v_n INTEGER;
  v_status VARCHAR;
  v_pid VARCHAR;
  v_meta_n INTEGER;
  v_safety_ok BOOLEAN;
  v_check VARIANT;
  v_edit VARCHAR;
  v_review VARCHAR;
  v_after VARCHAR;
  v_approver VARCHAR;
  v_send VARIANT;
  v_message VARCHAR;
BEGIN
  v_decision := UPPER(TRIM(COALESCE(p_decision, '')));
  IF (v_decision NOT IN ('APPROVED', 'EDITED', 'REJECTED')) THEN
    RETURN OBJECT_CONSTRUCT_KEEP_NULL('ok', FALSE, 'action_id', p_action_id, 'code', 'BAD_DECISION',
      'message', 'Decision must be APPROVED, EDITED or REJECTED.');
  END IF;

  SELECT COUNT(*), MAX(status), MAX(patient_id) INTO :v_n, :v_status, :v_pid
    FROM ACTION_QUEUE WHERE action_id = :p_action_id;
  IF (v_n = 0) THEN
    RETURN OBJECT_CONSTRUCT_KEEP_NULL('ok', FALSE, 'action_id', p_action_id, 'code', 'NOT_FOUND',
      'message', 'Action ' || COALESCE(p_action_id::VARCHAR, 'NULL') || ' does not exist.');
  END IF;
  IF (COALESCE(v_status, '') <> 'PENDING') THEN
    RETURN OBJECT_CONSTRUCT_KEEP_NULL('ok', FALSE, 'action_id', p_action_id, 'code', 'NOT_PENDING',
      'status', v_status,
      'message', 'Action ' || p_action_id || ' is ' || v_status || '; only a PENDING draft can be reviewed.');
  END IF;
  IF (v_decision = 'REJECTED' AND LENGTH(TRIM(COALESCE(p_note, ''))) < 10) THEN
    RETURN OBJECT_CONSTRUCT_KEEP_NULL('ok', FALSE, 'action_id', p_action_id, 'code', 'REASON_REQUIRED',
      'status', v_status,
      'message', 'A reason of at least 10 characters is required to reject.');
  END IF;

  IF (v_decision = 'EDITED') THEN
    IF (LENGTH(TRIM(COALESCE(p_edited_text, ''))) = 0) THEN
      RETURN OBJECT_CONSTRUCT_KEEP_NULL('ok', FALSE, 'action_id', p_action_id, 'code', 'EDIT_REQUIRED',
        'status', v_status, 'message', 'Edited text is required to save an edit.');
    END IF;
    SELECT SAFETY_CHECK(:p_edited_text) INTO :v_check;
    IF (NOT GET(v_check, 'ok')::BOOLEAN) THEN
      RETURN OBJECT_CONSTRUCT_KEEP_NULL('ok', FALSE, 'action_id', p_action_id, 'code', 'SAFETY',
        'status', v_status, 'hits', GET(v_check, 'hits'),
        'message', 'The edited text names a drug or a dose (' || ARRAY_TO_STRING(GET(v_check, 'hits'), ', ')
                   || '). Name the guideline step only; the prescriber chooses the drug.');
    END IF;
    v_edit := p_edited_text;
  END IF;

  IF (v_decision IN ('APPROVED', 'EDITED')) THEN
    SELECT COUNT(*), BOOLAND_AGG(COALESCE(safety_ok, FALSE)) INTO :v_meta_n, :v_safety_ok
      FROM ACTION_META WHERE action_id = :p_action_id;
    IF (v_meta_n = 0) THEN
      RETURN OBJECT_CONSTRUCT_KEEP_NULL('ok', FALSE, 'action_id', p_action_id, 'code', 'NO_DRAFT_RECORD',
        'status', v_status,
        'message', 'Action ' || p_action_id || ' has no Tether draft record (ACTION_META), so it cannot be sent. Reject it with a reason.');
    END IF;
    IF (v_decision = 'APPROVED' AND NOT v_safety_ok) THEN
      RETURN OBJECT_CONSTRUCT_KEEP_NULL('ok', FALSE, 'action_id', p_action_id, 'code', 'SAFETY',
        'status', v_status,
        'message', 'This draft failed the drug and dose post-check. Edit it or reject it.');
    END IF;
  END IF;

  CALL REVIEW_ACTION(:p_action_id, :v_decision, :p_note, :v_edit) INTO :v_review;
  SELECT MAX(status) INTO :v_after FROM ACTION_QUEUE WHERE action_id = :p_action_id;
  IF (COALESCE(v_after, '') <> v_decision) THEN
    RETURN OBJECT_CONSTRUCT_KEEP_NULL('ok', FALSE, 'action_id', p_action_id, 'code', 'NOT_APPLIED',
      'status', v_after, 'message', 'The decision did not apply: ' || COALESCE(v_review, 'no result'));
  END IF;
  IF (v_decision = 'EDITED') THEN
    UPDATE ACTION_META
       SET safety_ok = TRUE, safety_notes = 'Edited by the clinician; drug and dose post-check passed'
     WHERE action_id = :p_action_id;
  END IF;

  SELECT COALESCE(NULLIF(TRIM(:p_approver), ''), MAX(value), 'Clinician') INTO :v_approver
    FROM TETHER_SETTINGS WHERE key = 'APPROVER_LABEL';
  INSERT INTO AUDIT_LOG (actor, event, action_id, detail)
    SELECT CURRENT_USER(), 'CLINICIAN_DECISION', :p_action_id,
           :v_pid || ' · CLINICIAN_ROLE · ' || :v_approver || ' · ' || :v_decision;

  IF (v_decision IN ('APPROVED', 'EDITED')) THEN
    CALL SEND_APPROVED(:p_action_id) INTO :v_send;
    SELECT MAX(status) INTO :v_after FROM ACTION_QUEUE WHERE action_id = :p_action_id;
  END IF;
  v_message := 'Action ' || p_action_id || ' ' || LOWER(v_decision)
               || CASE WHEN v_after = 'SENT' THEN '; ' || COALESCE(GET(v_send, 'message')::VARCHAR, 'sent')
                       WHEN v_decision = 'REJECTED' THEN ''
                       ELSE '; not sent: ' || COALESCE(GET(v_send, 'message')::VARCHAR, 'no send result') END;
  RETURN OBJECT_CONSTRUCT_KEEP_NULL('ok', TRUE, 'action_id', p_action_id, 'decision', v_decision,
    'status', v_after, 'sent', v_after = 'SENT', 'send', v_send, 'message', v_message);
END;
$$;

-- ---------------------------------------------------------------------
-- LOG_REVIEW_DENIED(action_id): audit row for the moment the care agent tries to approve and
-- Snowflake refuses (CARE_AGENT_ROLE has no USAGE on TETHER_REVIEW or REVIEW_ACTION). The app
-- calls it after the refusal.
-- ---------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE LOG_REVIEW_DENIED(p_action_id NUMBER)
COPY GRANTS
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS OWNER
AS
$$
DECLARE
  v_n INTEGER;
  v_pid VARCHAR;
  v_detail VARCHAR;
BEGIN
  SELECT COUNT(*), MAX(patient_id) INTO :v_n, :v_pid FROM ACTION_QUEUE WHERE action_id = :p_action_id;
  IF (v_n = 0) THEN
    RETURN OBJECT_CONSTRUCT_KEEP_NULL('ok', FALSE, 'action_id', p_action_id, 'code', 'NOT_FOUND',
      'message', 'Action ' || COALESCE(p_action_id::VARCHAR, 'NULL') || ' does not exist; nothing was logged.');
  END IF;
  v_detail := v_pid || ' · CARE_AGENT_ROLE tried to approve; Snowflake refused';
  INSERT INTO AUDIT_LOG (actor, event, action_id, detail)
    SELECT CURRENT_USER(), 'REVIEW_DENIED', :p_action_id, :v_detail;
  RETURN OBJECT_CONSTRUCT_KEEP_NULL('ok', TRUE, 'action_id', p_action_id, 'message', v_detail);
END;
$$;

-- ---------------------------------------------------------------------
-- SIMULATE_CHECKIN_CALL(action_id, scenario): a simulated AI check-in call for a SENT
-- AI_CHECKIN_CALL action to the patient. No real call is placed. Allowed only with consent on
-- file (PATIENT_PROFILE.ai_call_consent) and when the AI Plan does not say "AI calls: not
-- allowed"; otherwise a person from the care team calls instead.
-- The disclosure line and the identity line are written by code; the identity line is always
-- "[two identifiers confirmed (simulated)]", so no name or date of birth is ever generated.
-- The reading type follows the condition: HTN BP, COPD SPO2, T2DM GLUCOSE.
--   ANSWERED    the patient reads out their latest reading of that type, logged to READINGS
--               (PATIENT_REPORT, taken_on = AS_OF), and gives the barrier "forgot" (BARRIER code 2,
--               logged), then picks a reminder time (the AI Plan contact window, else 8:00 AM).
--               Claude (TETHER_SETTINGS MODEL_CALLER) writes the turns after the identity line from
--               these facts only; its text is used only if it passes SAFETY_CHECK, contains no
--               display name, keeps the "Agent:" / "Patient:" format and repeats the reading,
--               else a code template is used. A reading in the red-flag range (BP-RED, DM-RED rows)
--               is handed off like CHEST_PAIN.
--   NO_ANSWER   attempt 1 drafts one PENDING retry call for the next day (kind CALL_RETRY);
--               attempt 2 drafts one PENDING ENG-4 clinician flag with a suggested callback text
--               (kind CALL_ESCALATION). Attempt = 1 for the first call, 2 for a retry call, plus
--               the unanswered attempts already logged on the same action. No draft while another
--               action is open for the patient and condition.
--   CHEST_PAIN  the call tells the patient to call 911 and ends (outcome HANDOFF); one urgent
--               clinician row (kind CALL_HANDOFF) is queued and its internal alert written to
--               OUTBOX at once (the only send without approval), unless one is already open.
-- Every attempt writes CALL_TRANSCRIPTS (answers built from SQL values, never parsed from model
-- text) and AUDIT_LOG CALL_ATTEMPT.
-- ---------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE SIMULATE_CHECKIN_CALL(p_action_id NUMBER, p_scenario VARCHAR)
COPY GRANTS
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS OWNER
AS
$$
DECLARE
  v_scenario VARCHAR;
  v_n INTEGER;
  v_pid VARCHAR;
  v_cond VARCHAR;
  v_rule VARCHAR;
  v_status VARCHAR;
  v_recipient VARCHAR;
  v_prefs VARCHAR;
  v_action_type VARCHAR;
  v_citation VARCHAR;
  v_kind VARCHAR;
  v_layer VARCHAR;
  v_consent BOOLEAN;
  v_ai_not_allowed INTEGER;
  v_asof DATE;
  v_ts TIMESTAMP_NTZ;
  v_call_id VARCHAR;
  v_rt VARCHAR;
  v_noun VARCHAR;
  v_prior INTEGER;
  v_attempt INTEGER;
  v_reading_n INTEGER DEFAULT 0;
  v_v1 FLOAT;
  v_v2 FLOAT;
  v_reading_text VARCHAR;
  v_reading_digits VARCHAR;
  v_red_n INTEGER DEFAULT 0;
  v_red BOOLEAN DEFAULT FALSE;
  v_red_rule VARCHAR;
  v_reminder VARCHAR;
  v_language VARCHAR;
  v_on_meds BOOLEAN DEFAULT FALSE;
  v_adherent FLOAT;
  v_adh_on DATE;
  v_adh_answer VARCHAR;
  v_header VARCHAR;
  v_disclosure VARCHAR;
  v_identity VARCHAR;
  v_body VARCHAR;
  v_transcript VARCHAR;
  v_transcript_model VARCHAR DEFAULT 'TEMPLATE';
  v_outcome VARCHAR;
  v_answers VARIANT;
  v_reading_obj VARIANT;
  v_model VARCHAR;
  v_params_ok BOOLEAN DEFAULT FALSE;
  v_prompt VARCHAR;
  v_out VARCHAR;
  v_model_call_id VARCHAR;
  v_check VARIANT;
  v_name_hits INTEGER;
  v_lines INTEGER;
  v_bad_lines INTEGER;
  v_reason VARCHAR;
  v_open_id NUMBER;
  v_last_rule VARCHAR;
  v_last_status VARCHAR;
  v_follow_id NUMBER;
  v_follow_kind VARCHAR;
  v_follow_note VARCHAR;
  v_f_rule VARCHAR;
  v_f_recipient VARCHAR;
  v_f_citation VARCHAR;
  v_f_evidence VARCHAR;
  v_f_text VARCHAR;
  v_f_check VARIANT;
  v_retry_on DATE;
  v_detail VARCHAR;
BEGIN
  v_scenario := UPPER(TRIM(COALESCE(p_scenario, '')));
  IF (v_scenario NOT IN ('ANSWERED', 'NO_ANSWER', 'CHEST_PAIN')) THEN
    RETURN OBJECT_CONSTRUCT_KEEP_NULL('ok', FALSE, 'action_id', p_action_id, 'code', 'BAD_SCENARIO',
      'message', 'Scenario must be ANSWERED, NO_ANSWER or CHEST_PAIN.');
  END IF;

  SELECT COUNT(*), MAX(q.patient_id), MAX(q.condition), MAX(q.rule_id), MAX(q.status), MAX(q.recipient),
         MAX(q.patient_prefs), MAX(r.action_type), MAX(r.citation)
    INTO :v_n, :v_pid, :v_cond, :v_rule, :v_status, :v_recipient, :v_prefs, :v_action_type, :v_citation
    FROM ACTION_QUEUE q LEFT JOIN RULES r ON r.rule_id = q.rule_id
   WHERE q.action_id = :p_action_id;
  IF (v_n = 0) THEN
    RETURN OBJECT_CONSTRUCT_KEEP_NULL('ok', FALSE, 'action_id', p_action_id, 'code', 'NOT_FOUND',
      'message', 'Action ' || COALESCE(p_action_id::VARCHAR, 'NULL') || ' does not exist.');
  END IF;
  SELECT MAX(kind), MAX(layer) INTO :v_kind, :v_layer FROM ACTION_META WHERE action_id = :p_action_id;
  IF (COALESCE(v_status, '') <> 'SENT' OR COALESCE(v_action_type, '') <> 'AI_CHECKIN_CALL'
      OR COALESCE(v_recipient, '') <> 'PATIENT' OR COALESCE(v_kind, '') = 'CALL_HANDOFF') THEN
    RETURN OBJECT_CONSTRUCT_KEEP_NULL('ok', FALSE, 'action_id', p_action_id, 'code', 'NOT_A_SENT_CALL',
      'status', v_status,
      'message', 'Only an approved and sent AI check-in call to the patient can be simulated. Action '
                 || p_action_id || ' is ' || COALESCE(v_action_type, v_rule) || ' with status ' || v_status || '.');
  END IF;

  SELECT COALESCE(BOOLAND_AGG(ai_call_consent), FALSE) INTO :v_consent
    FROM PATIENT_PROFILE WHERE patient_id = :v_pid;
  SELECT COUNT(*) INTO :v_ai_not_allowed
    FROM V_ACTIVE_OVERRIDES WHERE patient_id = :v_pid AND setting = 'AI_CALLS' AND yn = 'N';
  IF (NOT v_consent OR v_ai_not_allowed > 0) THEN
    RETURN OBJECT_CONSTRUCT_KEEP_NULL('ok', FALSE, 'action_id', p_action_id, 'code', 'NO_CONSENT',
      'message', v_pid || ': ' || IFF(v_ai_not_allowed > 0, 'the AI Plan says AI calls are not allowed',
                                     'no consent to automated calls on file')
                 || '. A person from the care team calls instead; no AI call was simulated.');
  END IF;

  SELECT MAX(as_of_date) INTO :v_asof FROM AS_OF;
  v_ts := CURRENT_TIMESTAMP()::TIMESTAMP_NTZ;
  v_call_id := UUID_STRING();
  v_rt := CASE v_cond WHEN 'HTN' THEN 'BP' WHEN 'COPD' THEN 'SPO2' WHEN 'T2DM' THEN 'GLUCOSE' END;
  v_noun := CASE v_rt WHEN 'BP' THEN 'blood pressure' WHEN 'SPO2' THEN 'oxygen level'
                      WHEN 'GLUCOSE' THEN 'blood sugar' ELSE 'home' END;
  SELECT COUNT(*) INTO :v_prior
    FROM CALL_TRANSCRIPTS WHERE action_id = :p_action_id AND outcome = 'NO_ANSWER';
  v_attempt := IFF(COALESCE(v_kind, '') = 'CALL_RETRY', 2, 1) + v_prior;

  v_header := 'Simulated call: no real call was placed · ' || v_pid || ' · ' || v_cond
              || ' · attempt ' || v_attempt || ' · ' || v_asof::VARCHAR;
  v_disclosure := 'Agent: Hello, this is an automated AI assistant calling for your care team. '
                  || 'This call only collects information for your care team.';
  v_identity := '[two identifiers confirmed (simulated)]';

  -- ANSWERED: the reading the patient reads out is their latest reading of the monitored type.
  IF (v_scenario = 'ANSWERED' AND v_rt IS NOT NULL) THEN
    SELECT COUNT(*), MAX(value1), MAX(value2) INTO :v_reading_n, :v_v1, :v_v2
      FROM (SELECT value1, value2 FROM READINGS
             WHERE patient_id = :v_pid AND reading_type = :v_rt
             ORDER BY taken_on DESC, value1 DESC, value2 DESC NULLS LAST
             LIMIT 1);
    IF (v_reading_n > 0) THEN
      v_reading_text := CASE v_rt WHEN 'BP' THEN ROUND(v_v1)::INT || '/' || ROUND(v_v2)::INT || ' mmHg'
                                  WHEN 'SPO2' THEN ROUND(v_v1)::INT || '%'
                                  ELSE ROUND(v_v1)::INT || ' mg/dL' END;
      v_reading_digits := CASE v_rt WHEN 'BP' THEN ROUND(v_v1)::INT || '/' || ROUND(v_v2)::INT
                                    ELSE ROUND(v_v1)::INT::VARCHAR END;
      IF (v_rt = 'BP') THEN
        SELECT COUNT(*) INTO :v_red_n FROM RULES
         WHERE rule_id = 'BP-RED' AND (:v_v1 >= threshold1 OR :v_v2 >= threshold2);
        v_red_rule := 'BP-RED';
      ELSEIF (v_rt = 'GLUCOSE') THEN
        SELECT COUNT(*) INTO :v_red_n FROM RULES WHERE rule_id = 'DM-RED' AND :v_v1 < threshold1;
        v_red_rule := 'DM-RED';
      END IF;
      v_red := v_red_n > 0;
      INSERT INTO READINGS (patient_id, condition, reading_type, value1, value2, taken_on, source)
        SELECT :v_pid, :v_cond, :v_rt, :v_v1, :v_v2, :v_asof, 'PATIENT_REPORT';
      v_reading_obj := OBJECT_CONSTRUCT_KEEP_NULL('reading_type', v_rt, 'value1', v_v1, 'value2', v_v2,
        'text', v_reading_text, 'taken_on', v_asof::VARCHAR, 'source', 'PATIENT_REPORT',
        'logged_to', 'READINGS', 'red_flag_rule', IFF(v_red, v_red_rule, NULL))::VARIANT;
    END IF;
  END IF;

  IF (v_scenario = 'NO_ANSWER') THEN
    -- ------------------------------------------------------------- no answer
    v_outcome := 'NO_ANSWER';
    v_transcript := v_header || '\n' || 'No answer. No message was left (simulated).';
    v_answers := OBJECT_CONSTRUCT_KEEP_NULL('answered', FALSE, 'simulated', TRUE)::VARIANT;
    SELECT MAX(action_id) INTO :v_open_id FROM ACTION_QUEUE
     WHERE patient_id = :v_pid AND condition = :v_cond AND status IN ('PENDING', 'APPROVED', 'EDITED');
    SELECT MAX(rule_id), MAX(status) INTO :v_last_rule, :v_last_status
      FROM (SELECT rule_id, status FROM ACTION_QUEUE
             WHERE patient_id = :v_pid AND condition = :v_cond
             ORDER BY created_at DESC, action_id DESC LIMIT 1);
    v_retry_on := DATEADD('day', 1, v_asof);
    IF (v_open_id IS NOT NULL) THEN
      v_follow_note := 'no new draft: action ' || v_open_id || ' is still open for ' || v_pid || ' ' || v_cond;
    ELSEIF (v_attempt = 1) THEN
      v_follow_kind := 'CALL_RETRY';
      v_f_rule := v_rule;
      v_f_recipient := 'PATIENT';
      v_f_evidence := 'AI check-in call not answered on ' || v_asof || ' (attempt 1, simulated); retry due ' || v_retry_on;
      v_f_text := 'Retry the AI check-in call to ' || v_pid || ' on ' || v_retry_on || ' (simulated). '
                  || 'The call on ' || v_asof || ' was not answered.' || '\n'
                  || 'Why: Rule ' || v_rule || ' (' || COALESCE(v_citation, 'no citation') || '). '
                  || 'Runbook: if the call is not answered, retry once the next day.';
    ELSEIF (v_last_rule = 'ENG-4' AND v_last_status IN ('SENT', 'REJECTED')) THEN
      v_follow_note := 'no new draft: the ENG-4 clinician flag for ' || v_pid || ' ' || v_cond
                       || ' was already ' || LOWER(v_last_status);
    ELSE
      v_follow_kind := 'CALL_ESCALATION';
      v_f_rule := 'ENG-4';
      SELECT MAX(recipient), MAX(citation) INTO :v_f_recipient, :v_f_citation FROM RULES WHERE rule_id = 'ENG-4';
      v_f_evidence := v_attempt || ' AI check-in calls not answered, the last on ' || v_asof || ' (simulated)';
      v_f_text := v_pid || ' did not answer ' || v_attempt || ' AI check-in calls (simulated; the last on '
                  || v_asof || '). At risk of lost to follow-up: offer a clinic or telehealth visit. '
                  || 'Suggested callback text for the patient: "Your care team tried to reach you about '
                  || 'your home readings. Please call us back at the clinic number on your card."' || '\n'
                  || 'Why: Rule ENG-4 (' || COALESCE(v_f_citation, 'no citation') || '). '
                  || 'Runbook: two unanswered calls move to ENG-4, the clinician flag.';
    END IF;
    IF (v_follow_kind IS NOT NULL) THEN
      SELECT SAFETY_CHECK(:v_f_text) INTO :v_f_check;
      INSERT INTO ACTION_QUEUE (patient_id, condition, rule_id, recipient, evidence, patient_prefs, draft_text,
                                status, created_at)
        SELECT :v_pid, :v_cond, :v_f_rule, :v_f_recipient, :v_f_evidence, :v_prefs, :v_f_text, 'PENDING', :v_ts;
      -- the new row: PENDING, these keys, and no ACTION_META yet (the open-action guard above makes it unique)
      SELECT MAX(q.action_id) INTO :v_follow_id FROM ACTION_QUEUE q
       WHERE q.patient_id = :v_pid AND q.condition = :v_cond AND q.rule_id = :v_f_rule
         AND q.recipient = :v_f_recipient AND q.status = 'PENDING' AND q.created_at = :v_ts
         AND NOT EXISTS (SELECT 1 FROM ACTION_META m WHERE m.action_id = q.action_id);
      INSERT INTO ACTION_META (action_id, run_id, kind, sim_date, layer, model, draft_source, safety_ok, safety_notes)
        SELECT :v_follow_id, :v_call_id, :v_follow_kind, :v_asof, COALESCE(:v_layer, 'P0'), NULL, 'RULE',
               GET(:v_f_check, 'ok')::BOOLEAN,
               IFF(GET(:v_f_check, 'ok')::BOOLEAN, 'Rule text; drug and dose post-check passed',
                   'Post-check flagged: ' || ARRAY_TO_STRING(GET(:v_f_check, 'hits'), ', '));
      v_follow_note := IFF(v_follow_kind = 'CALL_RETRY', 'retry call drafted', 'ENG-4 clinician flag drafted')
                       || ' as action ' || v_follow_id;
    END IF;

  ELSEIF (v_scenario = 'CHEST_PAIN' OR v_red) THEN
    -- ------------------------------------------------------------- hand off to a person
    v_outcome := 'HANDOFF';
    v_reason := IFF(v_red, 'a ' || v_noun || ' reading of ' || v_reading_text || ' (red-flag range, rule '
                           || v_red_rule || ')', 'chest pain');
    v_body := IFF(v_red,
      'Agent: Can you take a ' || v_noun || ' reading now and read me the numbers?' || '\n'
      || 'Patient: It says ' || v_reading_text || '.' || '\n'
      || 'Agent: Thank you. I am connecting this to the on-call clinician now. If this is an emergency, hang up and call 911.' || '\n'
      || 'Agent: Your care team will call you right away. Goodbye.',
      'Agent: Can you take a ' || v_noun || ' reading now and read me the numbers?' || '\n'
      || 'Patient: I have chest pain right now.' || '\n'
      || 'Agent: Please hang up and call 911 now. I am alerting the on-call clinician.' || '\n'
      || 'Agent: This call is ending so you can call 911. Goodbye.');
    v_transcript := v_header || '\n' || v_disclosure || '\n' || v_identity || '\n' || v_body;
    v_answers := OBJECT_CONSTRUCT_KEEP_NULL('answered', TRUE, 'identity', 'two identifiers confirmed (simulated)',
      'handoff', TRUE, 'reason', IFF(v_red, 'red-flag reading', 'chest pain'), 'reading', v_reading_obj,
      'told_to_call_911', TRUE, 'simulated', TRUE)::VARIANT;
    SELECT MAX(q.action_id) INTO :v_open_id
      FROM ACTION_QUEUE q JOIN ACTION_META m ON m.action_id = q.action_id
     WHERE q.patient_id = :v_pid AND q.condition = :v_cond AND q.rule_id = :v_rule
       AND q.status IN ('PENDING', 'APPROVED', 'EDITED') AND m.kind = 'CALL_HANDOFF';
    IF (v_open_id IS NOT NULL) THEN
      v_follow_id := v_open_id;
      v_follow_note := 'urgent clinician alert ' || v_open_id || ' is already open; no new alert';
    ELSE
      v_follow_kind := 'CALL_HANDOFF';
      v_f_evidence := 'AI check-in call on ' || v_asof || ' (simulated): patient reported ' || v_reason
                      || '; told to call 911';
      v_f_text := 'Urgent: ' || v_pid || ' reported ' || v_reason || ' on the AI check-in call on ' || v_asof
                  || ' (simulated). The call told the patient to call 911 for an emergency and ended. '
                  || 'Call the patient now.' || '\n'
                  || 'Why: Runbook, AI check-in calls: symptoms or a red-flag reading hand off to a person at once. '
                  || 'Rule ' || v_rule || ' (' || COALESCE(v_citation, 'no citation') || ').';
      SELECT SAFETY_CHECK(:v_f_text) INTO :v_f_check;
      INSERT INTO ACTION_QUEUE (patient_id, condition, rule_id, recipient, evidence, patient_prefs, draft_text,
                                status, created_at)
        SELECT :v_pid, :v_cond, :v_rule, 'CLINICIAN', :v_f_evidence, :v_prefs, :v_f_text, 'PENDING', :v_ts;
      SELECT MAX(q.action_id) INTO :v_follow_id FROM ACTION_QUEUE q
       WHERE q.patient_id = :v_pid AND q.condition = :v_cond AND q.rule_id = :v_rule
         AND q.recipient = 'CLINICIAN' AND q.status = 'PENDING' AND q.created_at = :v_ts
         AND NOT EXISTS (SELECT 1 FROM ACTION_META m WHERE m.action_id = q.action_id);
      INSERT INTO ACTION_META (action_id, run_id, kind, sim_date, layer, model, draft_source, safety_ok, safety_notes)
        SELECT :v_follow_id, :v_call_id, 'CALL_HANDOFF', :v_asof, COALESCE(:v_layer, 'P0'), NULL, 'RULE',
               GET(:v_f_check, 'ok')::BOOLEAN,
               IFF(GET(:v_f_check, 'ok')::BOOLEAN, 'Rule text; drug and dose post-check passed',
                   'Post-check flagged: ' || ARRAY_TO_STRING(GET(:v_f_check, 'hits'), ', '));
      -- the internal alert to the clinician goes out at once (red-flag exception to approval)
      INSERT INTO OUTBOX (msg_id, action_id, channel, recipient, patient_id, payload, provider, sent_sim)
        SELECT UUID_STRING(), :v_follow_id, 'INTERNAL_ALERT', 'CLINICIAN', :v_pid, :v_f_text, 'simulated', :v_asof;
      INSERT INTO AUDIT_LOG (actor, event, action_id, detail)
        SELECT CURRENT_USER(), 'CALL_HANDOFF', :v_follow_id,
               :v_pid || ' · patient reported ' || :v_reason || ' on the AI check-in call (simulated) · '
               || 'urgent clinician alert sent as INTERNAL_ALERT';
      v_follow_note := 'urgent clinician alert queued as action ' || v_follow_id || ' and sent as INTERNAL_ALERT';
    END IF;

  ELSE
    -- ------------------------------------------------------------- answered
    v_outcome := 'ANSWERED';
    INSERT INTO READINGS (patient_id, condition, reading_type, value1, value2, taken_on, source)
      SELECT :v_pid, :v_cond, 'BARRIER', 2, NULL, :v_asof, 'PATIENT_REPORT';
    SELECT MAX(raw_value) INTO :v_reminder FROM V_ACTIVE_OVERRIDES
     WHERE patient_id = :v_pid AND setting = 'CONTACT_WINDOW';
    v_reminder := COALESCE(v_reminder, '8:00 AM');
    SELECT MAX(raw_value) INTO :v_language FROM V_ACTIVE_OVERRIDES
     WHERE patient_id = :v_pid AND setting = 'LANGUAGE';
    SELECT COUNT(*) > 0 INTO :v_on_meds FROM MEDICATIONS
     WHERE patient_id = :v_pid AND condition = :v_cond AND active;
    -- adherence answer mirrors the latest adherence report on file (nothing is invented)
    SELECT MAX(value1), MAX(taken_on) INTO :v_adherent, :v_adh_on
      FROM (SELECT value1, taken_on FROM READINGS
             WHERE patient_id = :v_pid AND condition = :v_cond AND reading_type = 'ADHERENCE'
             ORDER BY taken_on DESC LIMIT 1);
    v_adh_answer := CASE WHEN NOT v_on_meds OR v_adherent IS NULL THEN NULL
                         WHEN v_adherent = 1 THEN 'taking it as prescribed'
                         ELSE 'missed some doses' END;

    v_prompt := 'You write a short simulated transcript of an automated AI check-in call for a care team. '
      || 'This is a demo with a synthetic patient; no real call is placed. '
      || 'Patient token: ' || v_pid || ' (synthetic). Call the person "Patient". Never invent a name, date of birth, address or any other identifier. '
      || 'The agent has already said it is an automated AI assistant and confirmed two identifiers; write only the turns after that. '
      || 'The agent collects information only: it never gives medical advice, never explains or judges the reading, and never names a drug, a drug class or a dose. '
      || 'Use only these facts, in this order. '
      || IFF(v_reading_n > 0,
             '1. The agent asks the patient to take a ' || v_noun || ' reading now; the patient reads ' || v_reading_text
             || '. The agent repeats ' || v_reading_digits || ' back and says it is logged for the care team. ',
             '1. The agent asks for a ' || v_noun || ' reading now; the patient cannot take one right now, and the agent says that is fine. ')
      || IFF(v_adh_answer IS NULL, '',
             '2. The agent asks whether the patient is taking their medicine as prescribed; the patient says they are ' || v_adh_answer || '. ')
      || '3. The agent asks what made it hard to send readings: no device, forgot, unsure how to measure, or cost. The patient says they forgot. '
      || '4. The agent offers reminder times; the patient picks ' || v_reminder || '. '
      || '5. The agent says the care team will review the call and says goodbye. '
      || 'Format: 6 to 10 lines, each starting with "Agent:" or "Patient:". Plain text only: no headings, no brackets, no markdown.'
      || IFF(v_language IS NOT NULL AND LOWER(v_language) NOT LIKE 'english%',
             ' Write the spoken words in ' || v_language || '; keep the labels "Agent:" and "Patient:" in English.', '');

    SELECT MAX(value) INTO :v_model FROM TETHER_SETTINGS WHERE key = 'MODEL_CALLER';
    IF (v_model IS NOT NULL) THEN
      SELECT COUNT_IF(value = 'TRUE') > 0 INTO :v_params_ok FROM TETHER_SETTINGS
       WHERE key = 'MODEL_PARAMS_OK_' || UPPER(REPLACE(:v_model, '-', '_'));
      BEGIN
        IF (v_params_ok) THEN
          SELECT AI_COMPLETE(model => :v_model, prompt => :v_prompt,
                             model_parameters => {'temperature': 0})::VARCHAR INTO :v_out;
        ELSE
          SELECT AI_COMPLETE(model => :v_model, prompt => :v_prompt)::VARCHAR INTO :v_out;
        END IF;
      EXCEPTION
        WHEN OTHER THEN
          v_out := NULL;
      END;
      v_model_call_id := UUID_STRING();
      INSERT INTO MODEL_CALLS (call_id, proc, model, input_text, output, ref_type, ref_id, patient_id, ok)
        SELECT :v_model_call_id, 'SIMULATE_CHECKIN_CALL', :v_model, :v_prompt, :v_out, 'ACTION',
               TO_VARCHAR(:p_action_id), :v_pid, :v_out IS NOT NULL;
    END IF;

    IF (v_out IS NOT NULL) THEN
      v_body := TRIM(REGEXP_REPLACE(v_out, '\r', ''));
      SELECT SAFETY_CHECK(:v_body) INTO :v_check;
      SELECT COUNT(*) INTO :v_name_hits
        FROM PATIENT_PROFILE p, LATERAL SPLIT_TO_TABLE(p.display_name, ' ') s
       WHERE p.patient_id = :v_pid AND LENGTH(s.value) >= 3 AND REGEXP_LIKE(s.value, '[A-Za-z]+')
         AND REGEXP_LIKE(:v_body, '.*(^|[^A-Za-z])' || s.value || '([^A-Za-z]|$).*', 'is');
      SELECT COUNT(*), COUNT_IF(NOT REGEXP_LIKE(TRIM(s.value), '(Agent|Patient):.*', 's'))
        INTO :v_lines, :v_bad_lines
        FROM TABLE(SPLIT_TO_TABLE(:v_body, '\n')) s
       WHERE TRIM(s.value) <> '';
      IF (GET(v_check, 'ok')::BOOLEAN AND v_name_hits = 0 AND v_bad_lines = 0
          AND v_lines BETWEEN 4 AND 14 AND LENGTH(v_body) <= 2000 AND NOT CONTAINS(v_body, '[')
          AND (v_reading_n = 0 OR CONTAINS(v_body, v_reading_digits))) THEN
        v_transcript_model := v_model;
      END IF;
    END IF;
    IF (v_transcript_model = 'TEMPLATE') THEN
      v_body := 'Agent: Can you take a ' || v_noun || ' reading now and read me the numbers?' || '\n'
        || IFF(v_reading_n > 0,
               'Patient: Yes. It says ' || v_reading_text || '.' || '\n'
               || 'Agent: Thank you. I have logged ' || v_reading_digits || ' for your care team.',
               'Patient: I cannot take one right now.' || '\n' || 'Agent: That is fine.') || '\n'
        || IFF(v_adh_answer IS NULL, '',
               'Agent: Are you taking your medicine as prescribed?' || '\n'
               || 'Patient: I am ' || v_adh_answer || '.' || '\n')
        || 'Agent: What has made it hard to send readings: no device, forgot, unsure how to measure, or cost?' || '\n'
        || 'Patient: I forgot.' || '\n'
        || 'Agent: I can send you a reminder. What time works for you?' || '\n'
        || 'Patient: ' || v_reminder || '.' || '\n'
        || 'Agent: I will send reminders then. Your care team will review this call. Goodbye.';
    END IF;
    v_transcript := v_header || '\n' || v_disclosure || '\n' || v_identity || '\n' || v_body;
    v_answers := OBJECT_CONSTRUCT_KEEP_NULL('answered', TRUE, 'identity', 'two identifiers confirmed (simulated)',
      'reading', v_reading_obj,
      'barrier', OBJECT_CONSTRUCT('code', 2, 'label', 'forgot', 'logged_to', 'READINGS'),
      'reminder_time', v_reminder,
      'adherence', IFF(v_on_meds, OBJECT_CONSTRUCT_KEEP_NULL('answer', v_adh_answer,
                                  'mirrors_report_on', v_adh_on::VARCHAR), NULL),
      'transcript_source', IFF(v_transcript_model = 'TEMPLATE', 'code template', 'Claude, post-checked'),
      'simulated', TRUE)::VARIANT;
  END IF;

  INSERT INTO CALL_TRANSCRIPTS (call_id, action_id, patient_id, attempt, outcome, transcript, answers, rule_id,
                                at_sim, scenario, model)
    SELECT :v_call_id, :p_action_id, :v_pid, :v_attempt, :v_outcome, :v_transcript, :v_answers, :v_rule,
           :v_asof, :v_scenario, :v_transcript_model;
  v_detail := v_pid || ' · attempt ' || v_attempt || ' · ' || v_outcome
              || IFF(v_reading_n > 0, ' · reading ' || v_reading_text || ' logged (PATIENT_REPORT)', '')
              || IFF(v_outcome = 'ANSWERED', ' · barrier forgot logged · reminder ' || v_reminder, '')
              || IFF(v_follow_note IS NULL, '', ' · ' || v_follow_note)
              || ' · simulated';
  INSERT INTO AUDIT_LOG (actor, event, action_id, detail)
    SELECT CURRENT_USER(), 'CALL_ATTEMPT', :p_action_id, :v_detail;

  RETURN OBJECT_CONSTRUCT_KEEP_NULL('ok', TRUE, 'action_id', p_action_id, 'call_id', v_call_id,
    'scenario', v_scenario, 'outcome', v_outcome, 'attempt', v_attempt, 'transcript', v_transcript,
    'answers', v_answers, 'model', v_transcript_model, 'model_call_id', v_model_call_id,
    'follow_up_action_id', v_follow_id, 'follow_up_kind', v_follow_kind, 'message', v_detail);
END;
$$;
