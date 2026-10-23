-- =====================================================================
-- Tether context pool: threshold edits on Faiz's RULES (the P0 layer).
--   UPDATE_RULE        saves one edit with its reason, a RULE_EDITS row and an AUDIT_LOG row.
--   PREVIEW_RULE_EDIT  makes the same edit inside a transaction it always rolls back, and reports
--                      which V_RULE_FIRINGS rows would change. Nothing is saved or audited.
-- Both return {ok, message, rule_id, field, old_value, new_value, changed_count, changed}, where
-- changed = [{patient_id, condition, before, after}] (rule ids, NULL = no firing).
-- Red flags are a floor: they can be tightened, never loosened.
-- Clinician only by grants (sql/85_tether_roles.sql); p_approver is a label, not a gate.
-- Runs after Faiz's sql/care_rules_snowflake.sql and sql/15_tether_tables.sql. Idempotent.
-- =====================================================================
USE SCHEMA CARE_RULES.CORE;

-- ---------------------------------------------------------------------
-- UPDATE_RULE: called inside an open transaction it joins it (so a test can roll it back);
-- otherwise the edit, RULE_EDITS and AUDIT_LOG commit together or not at all.
-- ---------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE UPDATE_RULE(p_rule_id VARCHAR, p_field VARCHAR, p_value FLOAT, p_reason VARCHAR, p_approver VARCHAR)
COPY GRANTS
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS OWNER
AS
$$
DECLARE
  rid         VARCHAR;
  f           VARCHAR;
  reason      VARCHAR;
  who         VARCHAR;
  n_rule      INTEGER;
  old_v       FLOAT;
  red_flag    BOOLEAN;
  old_txt     VARCHAR;
  new_txt     VARCHAR;
  refusal     VARCHAR;
  before_arr  ARRAY;
  after_arr   ARRAY;
  changed     ARRAY;
  n_changed   INTEGER;
  eid         VARCHAR;
  detail      VARCHAR;
  err         VARCHAR;
  own_txn     BOOLEAN DEFAULT FALSE;
BEGIN
  rid := UPPER(TRIM(COALESCE(p_rule_id, '')));
  f := LOWER(TRIM(COALESCE(p_field, '')));
  reason := TRIM(COALESCE(p_reason, ''));
  who := COALESCE(NULLIF(TRIM(p_approver), ''), CURRENT_USER());

  SELECT COUNT(*),
         MAX(CASE :f WHEN 'threshold1' THEN threshold1 WHEN 'threshold2' THEN threshold2
                     WHEN 'window_days' THEN window_days WHEN 'min_readings' THEN min_readings END),
         BOOLOR_AGG(action_type = 'URGENT_ALERT')
    INTO :n_rule, :old_v, :red_flag
    FROM RULES
   WHERE rule_id = :rid;
  old_txt := TO_VARCHAR(old_v);
  new_txt := TO_VARCHAR(p_value);

  -- Same checks as PREVIEW_RULE_EDIT, plus the reason.
  refusal := CASE
    WHEN f NOT IN ('threshold1', 'threshold2', 'window_days', 'min_readings')
      THEN 'Field must be threshold1, threshold2, window_days or min_readings.'
    WHEN n_rule = 0 THEN 'There is no rule ' || rid || ' in RULES.'
    WHEN n_rule > 1 THEN 'RULES has more than one row for ' || rid || '; nothing changed.'
    WHEN rid IN ('HOLD', 'PLAN-REVIEW', 'ENG-3H')
      THEN rid || ' is applied from the clinician''s AI Plan; V_RULE_FIRINGS reads none of its numbers.'
    WHEN old_v IS NULL THEN rid || ' has no ' || f || ', so there is nothing to edit.'
    WHEN p_value IS NULL THEN 'A new value is required.'
    WHEN f IN ('window_days', 'min_readings') AND (p_value < 1 OR p_value <> ROUND(p_value))
      THEN f || ' must be a whole number of 1 or more.'
    WHEN p_value < 0 THEN f || ' must be zero or more.'
    WHEN p_value = old_v THEN rid || ' ' || f || ' is already ' || old_txt || '; nothing changed.'
    WHEN red_flag AND f IN ('threshold1', 'threshold2') AND rid NOT IN ('BP-RED', 'DM-RED')
      THEN rid || ' is a red flag and this check does not know which way its threshold loosens, so the edit is refused.'
    WHEN red_flag AND CASE
           WHEN f = 'window_days'  THEN p_value < old_v   -- a shorter look-back sees fewer readings
           WHEN f = 'min_readings' THEN p_value > old_v
           WHEN rid = 'BP-RED'     THEN p_value > old_v   -- fires at or above the thresholds
           WHEN rid = 'DM-RED'     THEN p_value < old_v   -- fires below the threshold
         END
      THEN rid || ' is a red flag: ' || f || ' ' || old_txt || ' -> ' || new_txt
           || ' would alert on fewer readings. Red flags can be tightened, never loosened.'
    WHEN LENGTH(reason) < 10 THEN 'A reason of at least 10 characters is required.'
  END;
  IF (refusal IS NOT NULL) THEN
    RETURN OBJECT_CONSTRUCT('ok', FALSE, 'message', refusal, 'rule_id', rid, 'field', f);
  END IF;

  SELECT ARRAY_AGG(OBJECT_CONSTRUCT('patient_id', patient_id, 'condition', condition, 'rule_id', rule_id))
    INTO :before_arr
    FROM V_RULE_FIRINGS;

  IF (CURRENT_TRANSACTION() IS NULL) THEN
    BEGIN TRANSACTION;
    own_txn := TRUE;
  END IF;

  UPDATE RULES
     SET threshold1   = IFF(:f = 'threshold1', :p_value, threshold1),
         threshold2   = IFF(:f = 'threshold2', :p_value, threshold2),
         window_days  = IFF(:f = 'window_days', :p_value::INTEGER, window_days),
         min_readings = IFF(:f = 'min_readings', :p_value::INTEGER, min_readings)
   WHERE rule_id = :rid;

  SELECT ARRAY_AGG(OBJECT_CONSTRUCT('patient_id', patient_id, 'condition', condition, 'rule_id', rule_id))
    INTO :after_arr
    FROM V_RULE_FIRINGS;

  -- Rows whose firing rule changed (or appeared, or went away)
  SELECT COALESCE(ARRAY_AGG(OBJECT_CONSTRUCT_KEEP_NULL(
                    'patient_id', COALESCE(b.patient_id, a.patient_id), 'condition', COALESCE(b.condition, a.condition),
                    'before', b.rule_id, 'after', a.rule_id))
                  WITHIN GROUP (ORDER BY COALESCE(b.patient_id, a.patient_id), COALESCE(b.condition, a.condition)),
                  ARRAY_CONSTRUCT()),
         COUNT(DISTINCT COALESCE(b.patient_id, a.patient_id))
    INTO :changed, :n_changed
    FROM (SELECT v.value:patient_id::VARCHAR AS patient_id, v.value:condition::VARCHAR AS condition,
                 v.value:rule_id::VARCHAR AS rule_id
          FROM TABLE(FLATTEN(input => :before_arr)) v) b
    FULL OUTER JOIN
         (SELECT v.value:patient_id::VARCHAR AS patient_id, v.value:condition::VARCHAR AS condition,
                 v.value:rule_id::VARCHAR AS rule_id
          FROM TABLE(FLATTEN(input => :after_arr)) v) a
      ON a.patient_id = b.patient_id AND a.condition = b.condition
   WHERE b.rule_id IS DISTINCT FROM a.rule_id;

  eid := UUID_STRING();
  INSERT INTO RULE_EDITS (edit_id, rule_id, field, old_value, new_value, reason, edited_by, impact)
  SELECT :eid, :rid, :f, :old_txt, :new_txt, :reason, :who,
         OBJECT_CONSTRUCT('changed_count', :n_changed, 'changed', :changed);

  detail := rid || ' ' || f || ' ' || old_txt || ' -> ' || new_txt || ': ' || reason
            || ' (' || n_changed || IFF(n_changed = 1, ' patient changed)', ' patients changed)');
  INSERT INTO AUDIT_LOG (actor, event, detail) VALUES (CURRENT_USER(), 'RULE_EDITED', :detail);

  IF (own_txn) THEN
    COMMIT;
  END IF;

  RETURN OBJECT_CONSTRUCT_KEEP_NULL(
    'ok', TRUE,
    'message', 'Saved ' || rid || ' ' || f || ': ' || old_txt || ' -> ' || new_txt || '. V_RULE_FIRINGS: '
               || n_changed || IFF(n_changed = 1, ' patient changed.', ' patients changed.'),
    'rule_id', rid, 'field', f, 'old_value', old_v, 'new_value', p_value,
    'changed_count', n_changed, 'changed', changed, 'edit_id', eid, 'edited_by', who);
EXCEPTION
  WHEN OTHER THEN
    err := SQLERRM;
    IF (own_txn) THEN
      ROLLBACK;
    ELSEIF (CURRENT_TRANSACTION() IS NOT NULL) THEN
      RAISE;   -- inside the caller's transaction: the caller decides whether to roll back
    END IF;
    RETURN OBJECT_CONSTRUCT('ok', FALSE, 'message', 'The edit failed and nothing was saved: ' || err,
                            'rule_id', rid, 'field', f);
END;
$$;

-- ---------------------------------------------------------------------
-- PREVIEW_RULE_EDIT: the edit runs inside a transaction that is always rolled back, then RULES is
-- hashed again to prove nothing changed. Inside an open transaction it refuses, because a nested
-- transaction would wait on the caller's lock on RULES.
-- ---------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE PREVIEW_RULE_EDIT(p_rule_id VARCHAR, p_field VARCHAR, p_value FLOAT)
COPY GRANTS
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS OWNER
AS
$$
DECLARE
  rid         VARCHAR;
  f           VARCHAR;
  n_rule      INTEGER;
  old_v       FLOAT;
  red_flag    BOOLEAN;
  old_txt     VARCHAR;
  new_txt     VARCHAR;
  refusal     VARCHAR;
  before_arr  ARRAY;
  after_arr   ARRAY;
  changed     ARRAY;
  n_changed   INTEGER;
  h_before    NUMBER;
  h_after     NUMBER;
  err         VARCHAR;
  own_txn     BOOLEAN DEFAULT FALSE;
BEGIN
  rid := UPPER(TRIM(COALESCE(p_rule_id, '')));
  f := LOWER(TRIM(COALESCE(p_field, '')));

  SELECT COUNT(*),
         MAX(CASE :f WHEN 'threshold1' THEN threshold1 WHEN 'threshold2' THEN threshold2
                     WHEN 'window_days' THEN window_days WHEN 'min_readings' THEN min_readings END),
         BOOLOR_AGG(action_type = 'URGENT_ALERT')
    INTO :n_rule, :old_v, :red_flag
    FROM RULES
   WHERE rule_id = :rid;
  old_txt := TO_VARCHAR(old_v);
  new_txt := TO_VARCHAR(p_value);

  -- Same checks as UPDATE_RULE (no reason needed for a preview).
  refusal := CASE
    WHEN f NOT IN ('threshold1', 'threshold2', 'window_days', 'min_readings')
      THEN 'Field must be threshold1, threshold2, window_days or min_readings.'
    WHEN n_rule = 0 THEN 'There is no rule ' || rid || ' in RULES.'
    WHEN n_rule > 1 THEN 'RULES has more than one row for ' || rid || '; nothing changed.'
    WHEN rid IN ('HOLD', 'PLAN-REVIEW', 'ENG-3H')
      THEN rid || ' is applied from the clinician''s AI Plan; V_RULE_FIRINGS reads none of its numbers.'
    WHEN old_v IS NULL THEN rid || ' has no ' || f || ', so there is nothing to edit.'
    WHEN p_value IS NULL THEN 'A new value is required.'
    WHEN f IN ('window_days', 'min_readings') AND (p_value < 1 OR p_value <> ROUND(p_value))
      THEN f || ' must be a whole number of 1 or more.'
    WHEN p_value < 0 THEN f || ' must be zero or more.'
    WHEN p_value = old_v THEN rid || ' ' || f || ' is already ' || old_txt || '; nothing changed.'
    WHEN red_flag AND f IN ('threshold1', 'threshold2') AND rid NOT IN ('BP-RED', 'DM-RED')
      THEN rid || ' is a red flag and this check does not know which way its threshold loosens, so the edit is refused.'
    WHEN red_flag AND CASE
           WHEN f = 'window_days'  THEN p_value < old_v   -- a shorter look-back sees fewer readings
           WHEN f = 'min_readings' THEN p_value > old_v
           WHEN rid = 'BP-RED'     THEN p_value > old_v   -- fires at or above the thresholds
           WHEN rid = 'DM-RED'     THEN p_value < old_v   -- fires below the threshold
         END
      THEN rid || ' is a red flag: ' || f || ' ' || old_txt || ' -> ' || new_txt
           || ' would alert on fewer readings. Red flags can be tightened, never loosened.'
    WHEN CURRENT_TRANSACTION() IS NOT NULL
      THEN 'The preview rolls back its own transaction, so it cannot run inside an open one. Call it on its own.'
  END;
  IF (refusal IS NOT NULL) THEN
    RETURN OBJECT_CONSTRUCT('ok', FALSE, 'message', refusal, 'rule_id', rid, 'field', f);
  END IF;

  SELECT HASH_AGG(*) INTO :h_before FROM RULES;
  SELECT ARRAY_AGG(OBJECT_CONSTRUCT('patient_id', patient_id, 'condition', condition, 'rule_id', rule_id))
    INTO :before_arr
    FROM V_RULE_FIRINGS;

  BEGIN TRANSACTION;   -- DML and SELECT only until the ROLLBACK
  own_txn := TRUE;
  UPDATE RULES
     SET threshold1   = IFF(:f = 'threshold1', :p_value, threshold1),
         threshold2   = IFF(:f = 'threshold2', :p_value, threshold2),
         window_days  = IFF(:f = 'window_days', :p_value::INTEGER, window_days),
         min_readings = IFF(:f = 'min_readings', :p_value::INTEGER, min_readings)
   WHERE rule_id = :rid;
  SELECT ARRAY_AGG(OBJECT_CONSTRUCT('patient_id', patient_id, 'condition', condition, 'rule_id', rule_id))
    INTO :after_arr
    FROM V_RULE_FIRINGS;
  ROLLBACK;
  own_txn := FALSE;

  SELECT HASH_AGG(*) INTO :h_after FROM RULES;

  SELECT COALESCE(ARRAY_AGG(OBJECT_CONSTRUCT_KEEP_NULL(
                    'patient_id', COALESCE(b.patient_id, a.patient_id), 'condition', COALESCE(b.condition, a.condition),
                    'before', b.rule_id, 'after', a.rule_id))
                  WITHIN GROUP (ORDER BY COALESCE(b.patient_id, a.patient_id), COALESCE(b.condition, a.condition)),
                  ARRAY_CONSTRUCT()),
         COUNT(DISTINCT COALESCE(b.patient_id, a.patient_id))
    INTO :changed, :n_changed
    FROM (SELECT v.value:patient_id::VARCHAR AS patient_id, v.value:condition::VARCHAR AS condition,
                 v.value:rule_id::VARCHAR AS rule_id
          FROM TABLE(FLATTEN(input => :before_arr)) v) b
    FULL OUTER JOIN
         (SELECT v.value:patient_id::VARCHAR AS patient_id, v.value:condition::VARCHAR AS condition,
                 v.value:rule_id::VARCHAR AS rule_id
          FROM TABLE(FLATTEN(input => :after_arr)) v) a
      ON a.patient_id = b.patient_id AND a.condition = b.condition
   WHERE b.rule_id IS DISTINCT FROM a.rule_id;

  IF (h_after <> h_before) THEN
    RETURN OBJECT_CONSTRUCT('ok', FALSE, 'message', 'RULES changed while the preview ran (another edit?). Run the preview again.',
                            'rule_id', rid, 'field', f, 'rules_unchanged', FALSE);
  END IF;

  RETURN OBJECT_CONSTRUCT_KEEP_NULL(
    'ok', TRUE,
    'message', 'Preview, nothing saved: ' || rid || ' ' || f || ' ' || old_txt || ' -> ' || new_txt || '. V_RULE_FIRINGS: '
               || n_changed || IFF(n_changed = 1, ' patient would change.', ' patients would change.'),
    'preview', TRUE,
    'rule_id', rid, 'field', f, 'old_value', old_v, 'new_value', p_value,
    'changed_count', n_changed, 'changed', changed, 'rules_unchanged', TRUE);
EXCEPTION
  WHEN OTHER THEN
    err := SQLERRM;
    IF (own_txn) THEN
      ROLLBACK;
    END IF;
    RETURN OBJECT_CONSTRUCT('ok', FALSE, 'message', 'The preview failed and nothing was saved: ' || err,
                            'rule_id', rid, 'field', f);
END;
$$;
