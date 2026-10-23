-- =====================================================================
-- Tether tracking views over Faiz's engine. Read only; no table is written here.
--   V_FIRINGS           Faiz's V_RULE_FIRINGS plus the layer and the AI Plan line behind it
--   V_HELD              firings the clinician held (rule HOLD): never drafts, never sendable
--   V_MONITORED_VALUES  Table 2: one row per patient x expected reading, with the ladder rung
-- Every number comes from RULES, PATIENTS or V_ACTIVE_OVERRIDES; app-facing dates are 'YYYY-MM-DD'.
-- Runs after Faiz's sql/care_rules_snowflake.sql and sql/15_tether_tables.sql. Idempotent.
-- =====================================================================
USE SCHEMA CARE_RULES.CORE;

-- ---------------------------------------------------------------------
-- V_FIRINGS: layer P2 (AI Plan) when an applied override changed the firing: HOLD, ENG-3H, or an
-- individualized BP or A1C goal behind a goal-based rule; PLAN-REVIEW items are P2 too. Else P0.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW V_FIRINGS COPY GRANTS AS
WITH f AS (SELECT * FROM V_RULE_FIRINGS),
ov AS (SELECT * FROM V_ACTIVE_OVERRIDES),
prefs AS (   -- the same items as Faiz's patient_prefs, in a stable order (his LISTAGG has none)
  SELECT f.patient_id, f.condition,
         LISTAGG(o.setting || ': ' || o.raw_value, '; ') WITHIN GROUP (ORDER BY o.setting) AS patient_prefs
  FROM f
  JOIN ov o ON o.patient_id = f.patient_id AND CONTAINS(f.patient_prefs, o.setting || ': ' || o.raw_value)
  GROUP BY f.patient_id, f.condition
)
SELECT f.patient_id, f.condition, f.rule_id, f.step, f.action_type, f.recipient, f.priority, f.evidence, f.citation,
       COALESCE(p.patient_prefs, f.patient_prefs) AS patient_prefs,
       IFF(f.rule_id IN ('HOLD', 'ENG-3H', 'PLAN-REVIEW') OR og.patient_id IS NOT NULL, 'P2', 'P0') AS layer,
       CASE f.rule_id
         WHEN 'HOLD'        THEN oh.note_id
         WHEN 'ENG-3H'      THEN oc.note_id
         WHEN 'PLAN-REVIEW' THEN REGEXP_SUBSTR(f.evidence, '^Note ([^ ]+) [(]', 1, 1, 'e', 1)
         ELSE og.note_id
       END AS override_note_id,
       f.action_type = 'URGENT_ALERT' AS is_red_flag,
       f.rule_id = 'HOLD' AS is_held,
       IFF(f.rule_id = 'HOLD', REGEXP_SUBSTR(f.evidence, 'would fire ([^,; ]+)', 1, 1, 'e', 1), NULL) AS held_rule,
       IFF(f.rule_id = 'HOLD', TO_VARCHAR(oh.date1, 'YYYY-MM-DD'), NULL) AS held_until
FROM f
LEFT JOIN prefs p ON p.patient_id = f.patient_id AND p.condition = f.condition
LEFT JOIN ov oh ON oh.patient_id = f.patient_id AND oh.setting = 'HOLD_ESCALATION_UNTIL'
LEFT JOIN ov oc ON oc.patient_id = f.patient_id AND oc.setting = 'AI_CALLS'
-- rules whose firing compares readings with the patient's goal
LEFT JOIN ov og ON og.patient_id = f.patient_id
               AND og.setting = CASE WHEN f.condition = 'HTN'  AND f.rule_id IN ('BP-1', 'BP-3', 'ADH') THEN 'BP_GOAL'
                                     WHEN f.condition = 'T2DM' AND f.rule_id IN ('DM-1', 'DM-2', 'ADH') THEN 'A1C_GOAL' END;

-- ---------------------------------------------------------------------
-- V_HELD: escalations held by the clinician's AI Plan until a date. Red flags are never held.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW V_HELD COPY GRANTS AS
SELECT f.patient_id, pp.display_name, f.condition, f.held_rule, f.held_until, f.override_note_id AS note_id, f.evidence
FROM V_FIRINGS f
LEFT JOIN PATIENT_PROFILE pp ON pp.patient_id = f.patient_id
WHERE f.is_held;

-- ---------------------------------------------------------------------
-- V_MONITORED_VALUES (Table 2). Device rows re-express Faiz's "monitored" and "eng" CTEs:
-- HTN -> BP, COPD -> SPO2, T2DM on insulin -> GLUCOSE, cadence from CAD-*, ladder from ENG-*,
-- ENG-DEV pause on a recent "no working device" barrier (code 1). Plus an A1C row per T2DM patient
-- (DM-1 interval for the patient's goal) and an ADHERENCE row per condition with an active
-- medication (ADH window_days). collect_flag = a reading arrived within the cadence;
-- action_flag = the current firing for that condition acts on this reading.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW V_MONITORED_VALUES COPY GRANTS AS
WITH d AS (SELECT as_of_date FROM AS_OF),
t AS (   -- the RULES numbers this view uses
  SELECT MAX(IFF(rule_id = 'BP-GOAL', threshold1, NULL))  AS bp_goal_sys,
         MAX(IFF(rule_id = 'BP-GOAL', threshold2, NULL))  AS bp_goal_dia,
         MAX(IFF(rule_id = 'DM-1',    threshold1, NULL))  AS a1c_days_not_at_goal,
         MAX(IFF(rule_id = 'DM-1',    threshold2, NULL))  AS a1c_days_at_goal,
         MAX(IFF(rule_id = 'ADH',     window_days, NULL)) AS adh_days,
         MAX(IFF(rule_id = 'ENG-1',   threshold1, NULL))  AS eng1,
         MAX(IFF(rule_id = 'ENG-2',   threshold1, NULL))  AS eng2,
         MAX(IFF(rule_id = 'ENG-3',   threshold1, NULL))  AS eng3,
         MAX(IFF(rule_id = 'ENG-4',   threshold1, NULL))  AS eng4,
         MAX(IFF(rule_id = 'ENG-DEV', window_days, NULL)) AS dev_days
  FROM RULES
),
ov AS (SELECT * FROM V_ACTIVE_OVERRIDES),
latest AS (   -- latest reading per patient and type (adherence per condition); same-day ties show the higher value
  SELECT patient_id, condition, reading_type, value1, value2, taken_on, source
  FROM READINGS
  QUALIFY ROW_NUMBER() OVER (PARTITION BY patient_id, reading_type, IFF(reading_type = 'ADHERENCE', condition, NULL)
                             ORDER BY taken_on DESC, value1 DESC NULLS LAST, value2 DESC NULLS LAST) = 1
),
barrier AS (  -- latest barrier report per patient/condition
  SELECT patient_id, condition, value1 AS code, taken_on
  FROM READINGS WHERE reading_type = 'BARRIER'
  QUALIFY ROW_NUMBER() OVER (PARTITION BY patient_id, condition ORDER BY taken_on DESC) = 1
),
called AS (   -- simulated AI check-in calls that were answered, by day
  SELECT DISTINCT patient_id, at_sim FROM CALL_TRANSCRIPTS WHERE outcome = 'ANSWERED'
),
fired AS (    -- the current firing per patient/condition and the reading it acts on (held rules count)
  SELECT f.patient_id, f.condition, f.held_rule, f.held_until, f.override_note_id,
         CASE
           WHEN COALESCE(f.held_rule, f.rule_id) IN ('BP-RED', 'BP-1', 'BP-3') THEN 'BP'
           WHEN COALESCE(f.held_rule, f.rule_id) = 'COPD-3' THEN 'SPO2'
           WHEN COALESCE(f.held_rule, f.rule_id) IN ('DM-RED', 'DM-3') THEN 'GLUCOSE'
           WHEN COALESCE(f.held_rule, f.rule_id) IN ('DM-1', 'DM-2') THEN 'A1C'
           WHEN f.rule_id = 'ADH' THEN 'ADHERENCE'
           WHEN f.rule_id LIKE 'ENG-%' THEN CASE f.condition WHEN 'HTN' THEN 'BP' WHEN 'COPD' THEN 'SPO2' ELSE 'GLUCOSE' END
         END AS reading_type
  FROM V_FIRINGS f
),
monitored AS (  -- which home measure each patient is expected to send (Faiz's rule)
  SELECT dx.patient_id, dx.condition, dx.diagnosed_on,
         CASE dx.condition WHEN 'HTN' THEN 'BP' WHEN 'COPD' THEN 'SPO2' ELSE 'GLUCOSE' END AS reading_type
  FROM DIAGNOSES dx
  WHERE dx.condition IN ('HTN','COPD')
     OR (dx.condition = 'T2DM' AND EXISTS (SELECT 1 FROM MEDICATIONS m
           WHERE m.patient_id = dx.patient_id AND m.condition = 'T2DM' AND m.active AND LOWER(m.drug_class) LIKE '%insulin%'))
),
eng AS (        -- how overdue it is, and whether the patient has no working device
  SELECT m.patient_id, m.condition, m.reading_type, c.window_days AS cadence_days, c.rule_id AS cadence_rule_id,
         l.value1, l.value2, l.taken_on, l.source, b.code AS barrier_code, b.taken_on AS barrier_on,
         DATEDIFF('day', COALESCE(l.taken_on, m.diagnosed_on), d.as_of_date) - c.window_days AS days_overdue,
         CASE WHEN b.code = 1 AND b.taken_on > DATEADD('day', -t.dev_days, d.as_of_date)
              THEN TRUE ELSE FALSE END AS no_device
  FROM monitored m
  CROSS JOIN d
  CROSS JOIN t
  JOIN RULES c ON c.rule_id = 'CAD-' || m.condition
  LEFT JOIN latest l ON l.patient_id = m.patient_id AND l.reading_type = m.reading_type
  LEFT JOIN barrier b ON b.patient_id = m.patient_id AND b.condition = m.condition
),
device_rows AS (
  SELECT e.patient_id, e.condition, e.reading_type, 'HOME_DEVICE' AS expected_source,
         e.cadence_days, e.cadence_rule_id,
         IFF(og.patient_id IS NOT NULL, 'P2', 'P0') AS layer,   -- BP goal from the AI Plan
         CASE e.reading_type WHEN 'BP'   THEN e.value1::INT || '/' || e.value2::INT
                             WHEN 'SPO2' THEN e.value1::INT || ' %'
                             ELSE e.value1::INT || ' mg/dL' END AS last_value,
         e.taken_on AS last_on, e.source, e.days_overdue,
         CASE WHEN e.no_device THEN 'ENG-DEV'
              WHEN e.days_overdue >= t.eng4 THEN 'ENG-4'
              WHEN e.days_overdue >= t.eng3 THEN IFF(oc.yn = 'N', 'ENG-3H', 'ENG-3')
              WHEN e.days_overdue >= t.eng2 THEN 'ENG-2'
              WHEN e.days_overdue >= t.eng1 THEN 'ENG-1' END AS rung,
         e.no_device AS paused,
         ARRAY_CONSTRUCT_COMPACT(
           IFF(e.reading_type = 'BP',
               'Goal < ' || COALESCE(og.num1, t.bp_goal_sys) || '/' || COALESCE(og.num2, t.bp_goal_dia)
               || IFF(og.patient_id IS NOT NULL, ' (AI Plan, note ' || og.note_id || ')', ' (BP-GOAL)'), NULL),
           CASE WHEN e.no_device THEN 'No working device reported ' || TO_VARCHAR(e.barrier_on, 'YYYY-MM-DD')
                WHEN e.barrier_code = 2 THEN 'Patient said they forgot'
                WHEN e.barrier_code = 3 THEN 'Patient unsure how to measure'
                WHEN e.barrier_code = 4 THEN 'Cost or access barrier reported' END,
           IFF(oc.yn = 'N', 'AI calls not allowed (note ' || oc.note_id || '): a person calls instead', NULL)
         ) AS note_parts
  FROM eng e
  CROSS JOIN t
  LEFT JOIN ov og ON og.patient_id = e.patient_id AND og.setting = 'BP_GOAL' AND e.reading_type = 'BP'
  LEFT JOIN ov oc ON oc.patient_id = e.patient_id AND oc.setting = 'AI_CALLS'
),
a1c_rows AS (   -- DM-1: threshold1 days between A1Cs when not at goal, threshold2 days when at goal
  SELECT dx.patient_id, dx.condition, 'A1C' AS reading_type, 'LAB' AS expected_source,
         IFF(l.value1 <= COALESCE(oa.num1, p.a1c_goal), t.a1c_days_at_goal, t.a1c_days_not_at_goal) AS cadence_days,
         'DM-1' AS cadence_rule_id,
         IFF(oa.patient_id IS NOT NULL, 'P2', 'P0') AS layer,   -- A1C goal from the AI Plan
         l.value1 || ' %' AS last_value,
         l.taken_on AS last_on, l.source,
         DATEDIFF('day', COALESCE(l.taken_on, dx.diagnosed_on), d.as_of_date)
           - IFF(l.value1 <= COALESCE(oa.num1, p.a1c_goal), t.a1c_days_at_goal, t.a1c_days_not_at_goal) AS days_overdue,
         NULL AS rung,
         FALSE AS paused,
         ARRAY_CONSTRUCT_COMPACT(
           CASE WHEN oa.patient_id IS NOT NULL THEN 'Goal < ' || oa.num1 || ' % (AI Plan, note ' || oa.note_id || ')'
                WHEN p.a1c_goal IS NOT NULL THEN 'Goal < ' || p.a1c_goal || ' % (on file)'
                ELSE 'No A1C goal on file' END) AS note_parts
  FROM DIAGNOSES dx
  JOIN PATIENTS p ON p.patient_id = dx.patient_id
  CROSS JOIN d
  CROSS JOIN t
  LEFT JOIN latest l ON l.patient_id = dx.patient_id AND l.reading_type = 'A1C'
  LEFT JOIN ov oa ON oa.patient_id = dx.patient_id AND oa.setting = 'A1C_GOAL'
  WHERE dx.condition = 'T2DM'
),
adherence_rows AS (   -- adherence check-in for a condition with an active medication; due from the start date if never reported
  SELECT m.patient_id, m.condition, 'ADHERENCE' AS reading_type, 'PATIENT_REPORT' AS expected_source,
         t.adh_days AS cadence_days, 'ADH' AS cadence_rule_id, 'P0' AS layer,
         CASE l.value1 WHEN 1 THEN 'Taking as prescribed' WHEN 0 THEN 'Missed doses' END
           || CASE l.value2 WHEN 1 THEN '; inhaler technique ok' WHEN 0 THEN '; inhaler technique not ok' ELSE '' END
           AS last_value,
         l.taken_on AS last_on, l.source,
         DATEDIFF('day', COALESCE(l.taken_on, m.started_on), d.as_of_date) - t.adh_days AS days_overdue,
         NULL AS rung,
         FALSE AS paused,
         ARRAY_CONSTRUCT_COMPACT(
           IFF(l.taken_on IS NULL, 'No report on file; on medication since ' || TO_VARCHAR(m.started_on, 'YYYY-MM-DD'), NULL),
           IFF(ock.patient_id IS NOT NULL, 'AI Plan: check-ins ' || ock.raw_value || ' (note ' || ock.note_id || ')', NULL)
         ) AS note_parts
  FROM (SELECT patient_id, condition, MIN(started_on) AS started_on
        FROM MEDICATIONS WHERE active GROUP BY patient_id, condition) m
  JOIN (SELECT DISTINCT patient_id, condition FROM DIAGNOSES) dx
    ON dx.patient_id = m.patient_id AND dx.condition = m.condition
  CROSS JOIN d
  CROSS JOIN t
  LEFT JOIN latest l ON l.patient_id = m.patient_id AND l.condition = m.condition AND l.reading_type = 'ADHERENCE'
  LEFT JOIN ov ock ON ock.patient_id = m.patient_id AND ock.setting = 'CHECKINS'
),
u AS (
  SELECT patient_id, condition, reading_type, expected_source, cadence_days, cadence_rule_id, layer, last_value,
         last_on, source, days_overdue, rung, paused, note_parts FROM device_rows
  UNION ALL
  SELECT patient_id, condition, reading_type, expected_source, cadence_days, cadence_rule_id, layer, last_value,
         last_on, source, days_overdue, rung, paused, note_parts FROM a1c_rows
  UNION ALL
  SELECT patient_id, condition, reading_type, expected_source, cadence_days, cadence_rule_id, layer, last_value,
         last_on, source, days_overdue, rung, paused, note_parts FROM adherence_rows
)
SELECT u.patient_id, u.condition, u.reading_type,
       CASE WHEN cl.patient_id IS NOT NULL THEN 'AI check-in call (simulated)'
            WHEN COALESCE(u.source, u.expected_source) = 'HOME_DEVICE' THEN 'Home device'
            WHEN COALESCE(u.source, u.expected_source) = 'LAB' THEN 'Lab'
            WHEN COALESCE(u.source, u.expected_source) = 'PATIENT_REPORT' THEN 'Patient report'
            ELSE COALESCE(u.source, u.expected_source) END AS resource,
       u.cadence_days::INT AS cadence_days,
       u.cadence_rule_id,
       u.layer,
       u.last_value,
       TO_VARCHAR(u.last_on, 'YYYY-MM-DD') AS last_on,
       DATEDIFF('day', u.last_on, d.as_of_date) AS days_since,
       u.days_overdue::INT AS days_overdue,
       COALESCE(u.last_on IS NOT NULL AND u.days_overdue <= 0, FALSE) AS collect_flag,
       fr.patient_id IS NOT NULL AS action_flag,
       u.rung,
       u.paused,
       NULLIF(ARRAY_TO_STRING(ARRAY_CAT(u.note_parts, ARRAY_CONSTRUCT_COMPACT(
         IFF(fr.held_rule IS NOT NULL,
             fr.held_rule || ' held until ' || fr.held_until || ' (note ' || fr.override_note_id || ')', NULL))), '. '), '') AS note
FROM u
CROSS JOIN d
LEFT JOIN fired fr ON fr.patient_id = u.patient_id AND fr.condition = u.condition AND fr.reading_type = u.reading_type
LEFT JOIN called cl ON cl.patient_id = u.patient_id AND cl.at_sim = u.last_on
                   AND u.source = 'PATIENT_REPORT' AND u.reading_type IN ('BP', 'SPO2', 'GLUCOSE');
