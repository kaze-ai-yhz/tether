-- =====================================================================
-- Tether app views (read by app/web through the SQL API).
-- Runs after Faiz's sql/care_rules_snowflake.sql and the Tether tables; never redefines his objects.
-- Idempotent: CREATE OR REPLACE VIEW ... COPY GRANTS keeps the role grants across reruns.
-- Conventions for the app:
--   * keys inside OBJECT_CONSTRUCT_KEEP_NULL are lower-case snake_case and always present (null when empty)
--   * dates are 'YYYY-MM-DD' strings, timestamps 'YYYY-MM-DDTHH24:MI:SS' strings (TO_VARCHAR)
--   * aggregates are pre-computed in CTEs (GROUP BY + ARRAY_AGG); no correlated subqueries
-- Firings are read from Faiz's V_RULE_FIRINGS. Layer, red-flag and hold fields are derived here
-- (the same layer rule DRAFT_ACTIONS writes to ACTION_META.layer):
--   layer P2 = rule HOLD, ENG-3H or PLAN-REVIEW, or BP-1/BP-3 with an applied BP_GOAL line, or DM-1/DM-2
--   with an applied A1C_GOAL line in V_ACTIVE_OVERRIDES; otherwise P0 (the RULES default).
--   is_red_flag = action_type URGENT_ALERT (or a call handoff action).
--   held_rule / held_until / note come from the HOLD evidence text ("would fire X, held until D per note N").
-- =====================================================================
USE SCHEMA CARE_RULES.CORE;

-- ---------------------------------------------------------------------
-- V_RULES: Faiz's RULES plus what the Rules tab needs.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW V_RULES COPY GRANTS AS
WITH firing_counts AS (
  SELECT rule_id, COUNT(*) AS firing_count
  FROM V_RULE_FIRINGS
  GROUP BY rule_id
),
last_edits AS (
  SELECT rule_id,
         OBJECT_CONSTRUCT_KEEP_NULL(
           'field', field, 'old_value', old_value, 'new_value', new_value, 'reason', reason,
           'edited_by', edited_by, 'edited_at', TO_VARCHAR(edited_at, 'YYYY-MM-DD"T"HH24:MI:SS')) AS last_edit
  FROM RULE_EDITS
  QUALIFY ROW_NUMBER() OVER (PARTITION BY rule_id ORDER BY edited_at DESC, edit_id DESC) = 1
)
SELECT r.rule_id, r.condition, r.step, r.threshold1, r.threshold2, r.window_days, r.min_readings,
       r.priority, r.action_type, r.recipient, r.citation,
       COALESCE(r.action_type = 'URGENT_ALERT', FALSE)    AS is_red_flag,
       COALESCE(STARTSWITH(r.citation, 'PLACEHOLDER'), FALSE) AS is_placeholder,
       -- only fields that already hold a value can be edited (no new clinical numbers)
       ARRAY_CONSTRUCT_COMPACT(
         IFF(r.threshold1   IS NOT NULL, 'threshold1',   NULL),
         IFF(r.threshold2   IS NOT NULL, 'threshold2',   NULL),
         IFF(r.window_days  IS NOT NULL, 'window_days',  NULL),
         IFF(r.min_readings IS NOT NULL, 'min_readings', NULL)) AS editable_fields,
       le.last_edit,
       COALESCE(fc.firing_count, 0) AS firing_count
FROM RULES r
LEFT JOIN firing_counts fc ON fc.rule_id = r.rule_id
LEFT JOIN last_edits le    ON le.rule_id = r.rule_id;

-- ---------------------------------------------------------------------
-- V_HELD: firings the clinician held through the AI Plan (rule HOLD). Not drafts; never sendable.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW V_HELD COPY GRANTS AS
SELECT f.patient_id,
       COALESCE(pp.display_name, f.patient_id) AS display_name,
       f.condition,
       REGEXP_SUBSTR(f.evidence, 'would fire ([A-Z0-9-]+)', 1, 1, 'e', 1)                 AS held_rule,
       REGEXP_SUBSTR(f.evidence, 'held until ([0-9]{4}-[0-9]{2}-[0-9]{2})', 1, 1, 'e', 1) AS held_until,
       REGEXP_SUBSTR(f.evidence, 'per note (N-[0-9]+)', 1, 1, 'e', 1)                     AS note_id,
       f.evidence
FROM V_RULE_FIRINGS f
LEFT JOIN PATIENT_PROFILE pp ON pp.patient_id = f.patient_id
WHERE f.rule_id = 'HOLD';

-- ---------------------------------------------------------------------
-- V_QUEUE: PENDING drafts only, with rule, evidence, Claude's draft split at the "Why:" line,
-- the rule the patient is at now (stale when it differs) and the last 14 relevant readings.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW V_QUEUE COPY GRANTS AS
WITH goal_notes AS (
  SELECT patient_id,
         MAX(IFF(setting = 'BP_GOAL',  note_id, NULL)) AS bp_goal_note,
         MAX(IFF(setting = 'A1C_GOAL', note_id, NULL)) AS a1c_goal_note
  FROM V_ACTIVE_OVERRIDES
  WHERE setting IN ('BP_GOAL', 'A1C_GOAL')
  GROUP BY patient_id
),
meta AS (
  SELECT action_id, kind, sim_date, layer, model, draft_source, safety_ok, safety_notes
  FROM ACTION_META
  QUALIFY ROW_NUMBER() OVER (PARTITION BY action_id ORDER BY created_at DESC) = 1
),
glucose AS (
  SELECT DISTINCT patient_id FROM READINGS WHERE reading_type = 'GLUCOSE'
),
dx AS (
  SELECT patient_id, MIN(condition) AS condition FROM DIAGNOSES GROUP BY patient_id
),
pq AS (
  SELECT q.action_id, q.patient_id, q.condition, q.rule_id, q.recipient, q.evidence, q.patient_prefs,
         q.draft_text, q.status, q.created_at,
         r.step, r.action_type, r.priority, r.citation,
         m.sim_date, m.model, m.draft_source, m.safety_ok, m.safety_notes,
         COALESCE(m.kind, CASE WHEN r.action_type = 'URGENT_ALERT' THEN 'RED_FLAG'
                               WHEN q.rule_id = 'PLAN-REVIEW'     THEN 'PLAN_REVIEW'
                               ELSE 'DRAFT' END) AS kind,
         COALESCE(m.layer, IFF(q.rule_id IN ('HOLD', 'ENG-3H', 'PLAN-REVIEW')
                               OR (q.rule_id IN ('BP-1', 'BP-3') AND g.bp_goal_note IS NOT NULL)
                               OR (q.rule_id IN ('DM-1', 'DM-2') AND g.a1c_goal_note IS NOT NULL),
                               'P2', 'P0')) AS layer,
         COALESCE(REGEXP_SUBSTR(q.evidence, 'per note (N-[0-9]+)', 1, 1, 'e', 1),
                  REGEXP_SUBSTR(q.evidence, '^Note (N-[0-9]+)', 1, 1, 'e', 1),
                  IFF(q.rule_id IN ('BP-1', 'BP-3'), g.bp_goal_note,  NULL),
                  IFF(q.rule_id IN ('DM-1', 'DM-2'), g.a1c_goal_note, NULL)) AS note_ref,
         -- the reading type that matters for this draft (PLAN items use the patient's diagnosis)
         CASE COALESCE(NULLIF(q.condition, 'PLAN'), dx.condition)
           WHEN 'HTN'  THEN 'BP'
           WHEN 'COPD' THEN 'SPO2'
           WHEN 'T2DM' THEN IFF(q.rule_id IN ('DM-1', 'DM-2', 'ADH', 'PLAN-REVIEW') OR gl.patient_id IS NULL,
                                'A1C', 'GLUCOSE')
         END AS reading_type,
         REGEXP_INSTR(q.draft_text, '^[ *_]*Why:', 1, 1, 0, 'm') AS why_pos
  FROM ACTION_QUEUE q
  LEFT JOIN RULES r       ON r.rule_id = q.rule_id
  LEFT JOIN meta m        ON m.action_id = q.action_id
  LEFT JOIN goal_notes g  ON g.patient_id = q.patient_id
  LEFT JOIN glucose gl    ON gl.patient_id = q.patient_id
  LEFT JOIN dx            ON dx.patient_id = q.patient_id
  WHERE q.status = 'PENDING'
),
ranked_readings AS (
  SELECT patient_id, reading_type, taken_on, value1, value2,
         ROW_NUMBER() OVER (PARTITION BY patient_id, reading_type ORDER BY taken_on DESC, value1 DESC) AS rn
  FROM READINGS
),
recent AS (
  SELECT pq.action_id,
         ARRAY_AGG(OBJECT_CONSTRUCT_KEEP_NULL(
                     'taken_on', TO_VARCHAR(x.taken_on, 'YYYY-MM-DD'), 'value1', x.value1, 'value2', x.value2,
                     'reading_type', x.reading_type))
           WITHIN GROUP (ORDER BY x.taken_on, x.value1) AS recent_readings
  FROM pq
  JOIN ranked_readings x
    ON x.patient_id = pq.patient_id AND x.reading_type = pq.reading_type AND x.rn <= 14
  GROUP BY pq.action_id
)
SELECT pq.action_id, pq.patient_id,
       COALESCE(pp.display_name, pq.patient_id) AS display_name,
       pq.condition, pq.rule_id,
       f.rule_id AS current_rule_id,
       (pq.kind IN ('DRAFT', 'PLAN_REVIEW', 'RED_FLAG') AND f.rule_id IS DISTINCT FROM pq.rule_id) AS stale,
       pq.kind, pq.step, pq.action_type, pq.recipient, pq.priority, pq.layer, pq.citation, pq.evidence,
       pq.patient_prefs,
       IFF(pq.layer = 'P2', pq.note_ref, NULL) AS override_note_id,
       pq.draft_text,
       IFF(pq.why_pos > 0, RTRIM(SUBSTR(pq.draft_text, 1, pq.why_pos - 1), ' \n\r\t'), pq.draft_text) AS draft_body,
       IFF(pq.why_pos > 0, TRIM(REGEXP_REPLACE(SUBSTR(pq.draft_text, pq.why_pos), '^[ *_]*Why:[ *_]*', '')), NULL)
         AS why_text,
       pq.status,
       TO_VARCHAR(pq.created_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS created_at,
       TO_VARCHAR(pq.sim_date, 'YYYY-MM-DD')                AS sim_date,
       pq.model, pq.draft_source, pq.safety_ok, pq.safety_notes,
       (COALESCE(pq.action_type = 'URGENT_ALERT', FALSE) OR pq.kind = 'CALL_HANDOFF') AS is_red_flag,
       COALESCE(pq.action_type = 'READING_REMINDER', FALSE)                          AS batchable,
       pp.ai_call_consent,
       COALESCE(rc.recent_readings, ARRAY_CONSTRUCT()) AS recent_readings
FROM pq
LEFT JOIN V_RULE_FIRINGS f   ON f.patient_id = pq.patient_id AND f.condition = pq.condition
LEFT JOIN PATIENT_PROFILE pp ON pp.patient_id = pq.patient_id
LEFT JOIN recent rc          ON rc.action_id = pq.action_id;

-- ---------------------------------------------------------------------
-- V_TIMELINE: AUDIT_LOG rows with the patient they concern and a readable line, newest first.
-- logged_at keeps milliseconds so events in the same second still sort in order.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW V_TIMELINE COPY GRANTS AS
SELECT COALESCE(q.patient_id, REGEXP_SUBSTR(a.detail, 'SYN-[0-9]{3}')) AS patient_id,
       TO_VARCHAR(a.logged_at, 'YYYY-MM-DD"T"HH24:MI:SS.FF3')           AS logged_at,
       a.actor, a.event, a.action_id, a.detail,
       CASE a.event
         WHEN 'APPROVED'           THEN 'Draft approved'
         WHEN 'EDITED'             THEN 'Draft edited and approved'
         WHEN 'REJECTED'           THEN 'Draft rejected'
         WHEN 'CLINICIAN_DECISION' THEN 'Clinician decision'
         WHEN 'SENT'               THEN 'Sent (simulated)'
         WHEN 'REVIEW_DENIED'      THEN 'Approval refused for the care agent role'
         WHEN 'RED_FLAG_ALERT'     THEN 'Red flag alert to the clinician'
         WHEN 'DRAFTS_GENERATED'   THEN 'Drafts generated'
         WHEN 'CLOCK_ADVANCED'     THEN 'Simulated clock advanced'
         WHEN 'CALL_ATTEMPT'       THEN 'AI check-in call (simulated)'
         WHEN 'CALL_HANDOFF'       THEN 'Call handed off to the clinician (simulated)'
         WHEN 'AI_PLAN_READ'       THEN 'AI Plan read by Claude'
         WHEN 'PLAN_COMPOSED'      THEN 'Plan composed from rules'
         WHEN 'PLAN_REJECTED'      THEN 'Plan rejected'
         WHEN 'RULE_EDITED'        THEN 'Rule threshold edited'
         WHEN 'DEMO_RESET'         THEN 'Demo reset'
         ELSE UPPER(LEFT(a.event, 1)) || LOWER(REPLACE(SUBSTR(a.event, 2), '_', ' '))
       END
       || IFF(a.action_id IS NOT NULL, ' · draft ' || a.action_id || COALESCE(' · ' || q.rule_id, ''), '')
       || COALESCE(' · ' || NULLIF(TRIM(REGEXP_REPLACE(a.detail, '^SYN-[0-9]{3} ·\\s*', '')), ''), '') AS line
FROM AUDIT_LOG a
LEFT JOIN ACTION_QUEUE q ON q.action_id = a.action_id
ORDER BY a.logged_at DESC;

-- ---------------------------------------------------------------------
-- V_PATIENT_LIST: one row per patient with the display status (most severe across conditions).
-- Per patient x condition, in order:
--   1 Needs clinician    open red flag or call handoff; pending item for the clinician; current firing
--                        routed to the clinician not yet handled; unresolved ID_FAILED call; plan REJECTED
--   2 Awaiting approval  any other PENDING draft
--   3 Action taken       latest action sent (or approved) and the rule now firing is none or the same rule
--   4 Pending            a firing not yet drafted, held by the clinician (HOLD) or whose draft was rejected;
--                        or nothing fired but a home reading (CAD-* cadence in V_MONITORED_VALUES) is due
--   5 Ongoing follow-up  diagnosed, nothing fired, readings current
--   6 Complete           plan closed by a clinician
--   7 Scheduled / 8 Visited · no AI Plan   patients without a diagnosis on file
-- "Handled" = the latest action for that patient x condition has the current rule and is SENT or REJECTED.
-- V_RULE_FIRINGS and V_MONITORED_VALUES take most of the compile time of an app request, so they are
-- expanded once here; the firings, hold and Table 2 arrays for V_PATIENT_DETAIL are built here as well.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW V_PATIENT_LIST COPY GRANTS AS
WITH ao AS (SELECT * FROM V_ACTIVE_OVERRIDES),
goal_notes AS (
  SELECT patient_id,
         MAX(IFF(setting = 'BP_GOAL',  note_id, NULL)) AS bp_goal_note,
         MAX(IFF(setting = 'A1C_GOAL', note_id, NULL)) AS a1c_goal_note
  FROM ao
  WHERE setting IN ('BP_GOAL', 'A1C_GOAL')
  GROUP BY patient_id
),
fir AS (   -- V_RULE_FIRINGS is costly to compile: it is expanded once here and reused below
  SELECT f.patient_id, f.condition, f.rule_id, f.step, f.action_type, f.recipient, f.priority, f.evidence,
         f.citation, f.patient_prefs,
         IFF(f.rule_id IN ('HOLD', 'ENG-3H', 'PLAN-REVIEW')
             OR (f.rule_id IN ('BP-1', 'BP-3') AND g.bp_goal_note IS NOT NULL)
             OR (f.rule_id IN ('DM-1', 'DM-2') AND g.a1c_goal_note IS NOT NULL), 'P2', 'P0') AS layer,
         COALESCE(REGEXP_SUBSTR(f.evidence, 'per note (N-[0-9]+)', 1, 1, 'e', 1),
                  REGEXP_SUBSTR(f.evidence, '^Note (N-[0-9]+)', 1, 1, 'e', 1),
                  IFF(f.rule_id IN ('BP-1', 'BP-3'), g.bp_goal_note,  NULL),
                  IFF(f.rule_id IN ('DM-1', 'DM-2'), g.a1c_goal_note, NULL)) AS note_ref,
         COALESCE(f.action_type = 'URGENT_ALERT', FALSE) AS is_red_flag,
         f.rule_id = 'HOLD' AS is_held,
         IFF(f.rule_id = 'HOLD', REGEXP_SUBSTR(f.evidence, 'would fire ([A-Z0-9-]+)', 1, 1, 'e', 1), NULL) AS held_rule,
         IFF(f.rule_id = 'HOLD', REGEXP_SUBSTR(f.evidence, 'held until ([0-9]{4}-[0-9]{2}-[0-9]{2})', 1, 1, 'e', 1), NULL)
           AS held_until,
         IFF(f.rule_id = 'HOLD', REGEXP_SUBSTR(f.evidence, 'per note (N-[0-9]+)', 1, 1, 'e', 1), NULL) AS held_note_id
  FROM V_RULE_FIRINGS f
  LEFT JOIN goal_notes g ON g.patient_id = f.patient_id
),
firing_list AS (   -- the firings array and the hold for V_PATIENT_DETAIL
  SELECT patient_id,
         ARRAY_AGG(OBJECT_CONSTRUCT_KEEP_NULL(
                     'patient_id', patient_id, 'condition', condition, 'rule_id', rule_id, 'step', step,
                     'action_type', action_type, 'recipient', recipient, 'priority', priority, 'evidence', evidence,
                     'citation', citation, 'patient_prefs', patient_prefs, 'layer', layer,
                     'override_note_id', IFF(layer = 'P2', note_ref, NULL),
                     'is_red_flag', is_red_flag, 'is_held', is_held, 'held_rule', held_rule))
           WITHIN GROUP (ORDER BY priority, condition) AS firings,
         GET(ARRAY_AGG(IFF(is_held, OBJECT_CONSTRUCT_KEEP_NULL('held_rule', held_rule, 'held_until', held_until,
                                                                'note_id', held_note_id), NULL))
               WITHIN GROUP (ORDER BY held_until DESC, condition), 0) AS held
  FROM fir
  GROUP BY patient_id
),
mv AS (SELECT * FROM V_MONITORED_VALUES),   -- expanded once, reused below
monitored_list AS (   -- the Table 2 array for V_PATIENT_DETAIL (last_on is already a 'YYYY-MM-DD' string)
  SELECT patient_id,
         ARRAY_AGG(OBJECT_CONSTRUCT_KEEP_NULL(
                     'patient_id', patient_id, 'condition', condition, 'reading_type', reading_type,
                     'resource', resource, 'cadence_days', cadence_days, 'cadence_rule_id', cadence_rule_id,
                     'layer', layer, 'last_value', last_value, 'last_on', last_on, 'days_since', days_since,
                     'days_overdue', days_overdue, 'collect_flag', collect_flag, 'action_flag', action_flag,
                     'rung', rung, 'paused', paused, 'note', note))
           WITHIN GROUP (ORDER BY condition, reading_type) AS monitored
  FROM mv
  GROUP BY patient_id
),
monitored AS (   -- Table 2 per patient x condition: ladder rung, and home readings (CAD-* cadence) not
                 -- received within their cadence
  SELECT mv.patient_id, mv.condition,
         MIN_BY(mv.rung, r.priority) AS rung,
         MIN(r.priority)             AS rung_priority,
         BOOLOR_AGG(mv.cadence_rule_id LIKE 'CAD-%' AND NOT mv.paused AND NOT mv.collect_flag) AS reading_due,
         MAX_BY(mv.reading_type || ' reading, '
                || IFF(mv.last_on IS NULL, 'not received yet',
                       mv.days_overdue || IFF(mv.days_overdue = 1, ' day', ' days') || ' overdue'),
                IFF(mv.cadence_rule_id LIKE 'CAD-%' AND NOT mv.paused AND NOT mv.collect_flag, mv.days_overdue, NULL))
           AS due_text
  FROM mv
  LEFT JOIN RULES r ON r.rule_id = mv.rung
  GROUP BY mv.patient_id, mv.condition
),
act AS (
  SELECT q.action_id, q.patient_id, q.condition, q.rule_id, q.recipient, q.status, q.evidence, q.created_at,
         r.step, r.priority, r.action_type,
         COALESCE(m.kind, CASE WHEN r.action_type = 'URGENT_ALERT' THEN 'RED_FLAG'
                               WHEN q.rule_id = 'PLAN-REVIEW'     THEN 'PLAN_REVIEW'
                               ELSE 'DRAFT' END) AS kind
  FROM ACTION_QUEUE q
  LEFT JOIN RULES r ON r.rule_id = q.rule_id
  LEFT JOIN (SELECT action_id, kind FROM ACTION_META
             QUALIFY ROW_NUMBER() OVER (PARTITION BY action_id ORDER BY created_at DESC) = 1) m
    ON m.action_id = q.action_id
),
open_act AS (   -- the most pressing open action per patient x condition
  SELECT patient_id, condition, rule_id, step, evidence, priority,
         CASE WHEN action_type = 'URGENT_ALERT' OR kind = 'CALL_HANDOFF' THEN 1
              WHEN recipient = 'CLINICIAN' THEN 2
              ELSE 3 END AS open_rank,
         SUM(IFF(status = 'PENDING', 1, 0)) OVER (PARTITION BY patient_id, condition) AS pending_n
  FROM act
  WHERE status = 'PENDING'
     OR (status IN ('APPROVED', 'EDITED') AND (action_type = 'URGENT_ALERT' OR kind = 'CALL_HANDOFF'))
  QUALIFY ROW_NUMBER() OVER (PARTITION BY patient_id, condition
                             ORDER BY open_rank, priority NULLS LAST, created_at, action_id) = 1
),
sends AS (
  SELECT action_id, MAX_BY(channel, sent_at) AS channel, MAX(sent_sim) AS sent_sim
  FROM OUTBOX
  GROUP BY action_id
),
last_act AS (   -- the latest action per patient x condition, with its simulated send
  SELECT a.patient_id, a.condition, a.rule_id, a.step, a.status, a.created_at, s.channel, s.sent_sim
  FROM act a
  LEFT JOIN sends s ON s.action_id = a.action_id
  QUALIFY ROW_NUMBER() OVER (PARTITION BY a.patient_id, a.condition ORDER BY a.created_at DESC, a.action_id DESC) = 1
),
last_call AS (
  SELECT c.patient_id, q.condition, c.outcome, c.created_at
  FROM CALL_TRANSCRIPTS c
  JOIN ACTION_QUEUE q ON q.action_id = c.action_id
  QUALIFY ROW_NUMBER() OVER (PARTITION BY c.patient_id, q.condition ORDER BY c.created_at DESC) = 1
),
plans AS (   -- latest plan per patient x condition
  SELECT plan_id, patient_id, condition, mode, status
  FROM CARE_PLANS
  QUALIFY ROW_NUMBER() OVER (PARTITION BY patient_id, condition ORDER BY created_at DESC) = 1
),
keys AS (
  SELECT patient_id, condition FROM DIAGNOSES
  UNION SELECT patient_id, condition FROM ACTION_QUEUE
),
pc AS (   -- every patient x condition that is diagnosed, has an action, or fires
  SELECT COALESCE(k.patient_id, f.patient_id) AS patient_id, COALESCE(k.condition, f.condition) AS condition,
         f.rule_id AS cur_rule_id, f.step AS cur_step, f.recipient AS cur_recipient, f.priority AS cur_priority,
         f.evidence AS cur_evidence, f.held_until, f.held_note_id
  FROM keys k
  FULL OUTER JOIN fir f ON f.patient_id = k.patient_id AND f.condition = k.condition
),
pc_full AS (
  SELECT pc.*,
         oa.rule_id AS open_rule_id, oa.step AS open_step, oa.evidence AS open_evidence, oa.priority AS open_priority,
         oa.open_rank, COALESCE(oa.pending_n, 0) AS pending_n,
         la.rule_id AS last_rule_id, la.step AS last_step, la.status AS last_status, la.created_at AS last_created_at,
         la.channel AS last_channel, la.sent_sim AS last_sent_sim,
         pl.status AS plan_state,
         mo.rung AS mon_rung, mo.rung_priority AS mon_rung_priority,
         COALESCE(mo.reading_due, FALSE) AS reading_due, mo.due_text,
         COALESCE(la.rule_id = pc.cur_rule_id AND la.status IN ('SENT', 'REJECTED'), FALSE) AS handled,
         COALESCE(lc.outcome = 'ID_FAILED' AND (la.created_at IS NULL OR la.created_at <= lc.created_at), FALSE)
           AS call_unresolved
  FROM pc
  LEFT JOIN open_act oa  ON oa.patient_id = pc.patient_id AND oa.condition = pc.condition
  LEFT JOIN last_act la  ON la.patient_id = pc.patient_id AND la.condition = pc.condition
  LEFT JOIN last_call lc ON lc.patient_id = pc.patient_id AND lc.condition = pc.condition
  LEFT JOIN plans pl     ON pl.patient_id = pc.patient_id AND pl.condition = pc.condition
  LEFT JOIN monitored mo ON mo.patient_id = pc.patient_id AND mo.condition = pc.condition
),
ranked AS (
  SELECT pc_full.*,
         CASE
           WHEN open_rank IN (1, 2)                                 THEN 1
           WHEN cur_recipient = 'CLINICIAN' AND NOT handled         THEN 1
           WHEN call_unresolved                                     THEN 1
           WHEN plan_state = 'REJECTED'                             THEN 1
           WHEN pending_n > 0                                       THEN 2
           WHEN last_status IN ('SENT', 'APPROVED', 'EDITED')
                AND (cur_rule_id IS NULL OR cur_rule_id = last_rule_id) THEN 3
           WHEN cur_rule_id IS NOT NULL OR reading_due              THEN 4
           WHEN plan_state = 'CLOSED'                               THEN 6
           ELSE 5
         END AS status_rank,
         CASE
           WHEN open_rank IN (1, 2)
             THEN open_rule_id || COALESCE(' ' || open_step, '') || ': ' || COALESCE(open_evidence, '')
           WHEN cur_recipient = 'CLINICIAN' AND NOT handled
             THEN cur_rule_id || ' ' || cur_step || ': ' || cur_evidence
           WHEN call_unresolved
             THEN 'Check-in call could not confirm identity (simulated); the clinician follows up'
           WHEN plan_state = 'REJECTED'
             THEN 'AI Plan rejected; guideline rules keep running'
           WHEN pending_n > 0
             THEN IFF(pending_n > 1, pending_n || ' drafts waiting for approval: ', 'Draft waiting for approval: ')
                  || open_rule_id || COALESCE(' ' || open_step, '')
           WHEN last_status IN ('SENT', 'APPROVED', 'EDITED') AND (cur_rule_id IS NULL OR cur_rule_id = last_rule_id)
             THEN last_rule_id || COALESCE(' ' || last_step, '')
                  || IFF(last_status = 'SENT',
                         ': sent' || COALESCE(' ' || TO_VARCHAR(last_sent_sim, 'YYYY-MM-DD'), '')
                         || COALESCE(' ' || CASE last_channel
                                              WHEN 'SMS'            THEN 'by text'
                                              WHEN 'AI_CALL'        THEN 'as an AI check-in call'
                                              WHEN 'PRESCRIBER'     THEN 'to the prescriber'
                                              WHEN 'PHARMACY'       THEN 'to the pharmacy'
                                              WHEN 'CLINICIAN'      THEN 'to the clinician'
                                              WHEN 'INTERNAL_ALERT' THEN 'as an internal alert'
                                            END, '')
                         || ' (simulated)',
                         ': approved, waiting to send')
           WHEN cur_rule_id = 'HOLD'
             THEN 'Escalation held until ' || COALESCE(held_until, 'a later date') || ' by the clinician'
                  || COALESCE(' (note ' || held_note_id || ')', '')
           WHEN last_status = 'REJECTED' AND last_rule_id = cur_rule_id
             THEN cur_rule_id || ' ' || cur_step || ': draft rejected by the clinician; no new draft until the rule changes'
           WHEN cur_rule_id IS NOT NULL
             THEN cur_rule_id || ' ' || cur_step || ': fired; draft not created yet'
           WHEN reading_due
             THEN 'Waiting on ' || COALESCE(due_text, 'a home reading')
           WHEN plan_state = 'CLOSED'
             THEN 'Plan closed by the clinician'
           ELSE 'Readings current; no rule fired'
         END AS status_reason,
         IFF(open_rank IS NOT NULL AND (open_rank IN (1, 2) OR pending_n > 0), open_priority, cur_priority)
           AS sort_priority
  FROM pc_full
),
win AS (   -- the most severe condition per patient, plus patient-level values computed over all its conditions
  SELECT patient_id, condition, cur_rule_id, cur_step, status_rank, status_reason,
         FIRST_VALUE(cur_rule_id) IGNORE NULLS OVER (
           PARTITION BY patient_id ORDER BY cur_priority NULLS LAST, condition
           ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS top_rule_id,
         FIRST_VALUE(cur_step) IGNORE NULLS OVER (
           PARTITION BY patient_id ORDER BY cur_priority NULLS LAST, condition
           ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS top_step,
         -- ladder rung: the current engagement firing, else Table 2
         FIRST_VALUE(IFF(cur_rule_id LIKE 'ENG-%', cur_rule_id, NULL)) IGNORE NULLS OVER (
           PARTITION BY patient_id ORDER BY cur_priority NULLS LAST, condition
           ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS eng_rung,
         FIRST_VALUE(mon_rung) IGNORE NULLS OVER (
           PARTITION BY patient_id ORDER BY mon_rung_priority NULLS LAST, condition
           ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS mon_rung,
         MAX(held_until) OVER (PARTITION BY patient_id) AS held_until
  FROM ranked
  QUALIFY ROW_NUMBER() OVER (PARTITION BY patient_id
                             ORDER BY status_rank, open_rank NULLS LAST, sort_priority NULLS LAST, condition) = 1
),
dx AS (
  SELECT patient_id, ARRAY_AGG(DISTINCT condition) WITHIN GROUP (ORDER BY condition) AS conditions
  FROM DIAGNOSES
  GROUP BY patient_id
),
plan_mode AS (
  SELECT patient_id,
         IFF(BOOLOR_AGG(mode = 'Custom'), 'Custom', MAX(mode)) AS mode,
         CASE WHEN BOOLOR_AGG(status = 'REJECTED')     THEN 'REJECTED'
              WHEN BOOLOR_AGG(status = 'NEEDS_REVIEW') THEN 'NEEDS_REVIEW'
              WHEN BOOLAND_AGG(status = 'CLOSED')      THEN 'CLOSED'
              ELSE 'ACTIVE' END AS status
  FROM plans
  GROUP BY patient_id
),
overrides AS (
  SELECT patient_id, COUNT_IF(status = 'APPLIED') AS applied_n, COUNT_IF(status <> 'APPLIED') AS not_applied_n
  FROM V_PATIENT_OVERRIDES
  GROUP BY patient_id
),
notes AS (
  SELECT patient_id, COUNT(*) AS notes_n, COUNT_IF(note_text LIKE '%AI PLAN%') AS ai_notes
  FROM CLINICAL_NOTES
  GROUP BY patient_id
),
todo_counts AS (
  SELECT t.patient_id, COUNT_IF(t.done) AS todos_done, COUNT(*) AS todos_total
  FROM TODOS t
  JOIN plans pl ON pl.plan_id = t.plan_id
  GROUP BY t.patient_id
),
pending AS (
  SELECT patient_id, COUNT(*) AS pending_count FROM ACTION_QUEUE WHERE status = 'PENDING' GROUP BY patient_id
),
last_reading AS (
  SELECT patient_id, MAX(taken_on) AS last_reading_on
  FROM READINGS
  WHERE reading_type IN ('BP', 'SPO2', 'GLUCOSE', 'A1C')
  GROUP BY patient_id
),
prefs AS (   -- contact preferences from the AI Plan (same settings Faiz passes to the drafter)
  SELECT patient_id, LISTAGG(setting || ': ' || raw_value, '; ') WITHIN GROUP (ORDER BY setting) AS prefs
  FROM ao
  WHERE setting IN ('LANGUAGE', 'CONTACT_WINDOW', 'DO_NOT_CONTACT', 'CHECKINS', 'REMINDER_CHANNEL', 'NOTIFY_IF', 'AI_CALLS')
  GROUP BY patient_id
)
SELECT p.patient_id,
       COALESCE(pp.display_name, p.patient_id) AS display_name,
       p.age,
       COALESCE(dx.conditions, ARRAY_CONSTRUCT()) AS conditions,
       COALESCE(pm.mode, CASE WHEN ov.applied_n > 0 THEN 'Custom' WHEN nt.ai_notes > 0 THEN 'Standard' END) AS ai_plan_mode,
       COALESCE(pm.status, CASE WHEN ov.not_applied_n > 0 THEN 'NEEDS_REVIEW' WHEN nt.ai_notes > 0 THEN 'ACTIVE' END)
         AS plan_status,
       COALESCE(td.todos_done, 0)  AS todos_done,
       COALESCE(td.todos_total, 0) AS todos_total,
       COALESCE(w.cur_rule_id, w.top_rule_id)              AS current_rule_id,
       IFF(w.cur_rule_id IS NOT NULL, w.cur_step, w.top_step) AS current_step,
       COALESCE(w.eng_rung, w.mon_rung) AS rung,
       CASE COALESCE(w.status_rank, IFF(COALESCE(nt.notes_n, 0) > 0 AND COALESCE(nt.ai_notes, 0) = 0, 8, 7))
         WHEN 1 THEN 'Needs clinician'
         WHEN 2 THEN 'Awaiting approval'
         WHEN 3 THEN 'Action taken'
         WHEN 4 THEN 'Pending'
         WHEN 5 THEN 'Ongoing follow-up'
         WHEN 6 THEN 'Complete'
         WHEN 7 THEN 'Scheduled'
         ELSE 'Visited · no AI Plan'
       END AS display_status,
       COALESCE(w.status_rank, IFF(COALESCE(nt.notes_n, 0) > 0 AND COALESCE(nt.ai_notes, 0) = 0, 8, 7)) AS status_rank,
       COALESCE(w.status_reason,
                IFF(COALESCE(nt.notes_n, 0) > 0 AND COALESCE(nt.ai_notes, 0) = 0, 'Visited; the note has no AI Plan',
                    'No diagnosis on file' || COALESCE('; next visit ' || TO_VARCHAR(pp.next_visit_on, 'YYYY-MM-DD'), '')))
         AS status_reason,
       TO_VARCHAR(pp.next_visit_on, 'YYYY-MM-DD')   AS next_visit_on,
       TO_VARCHAR(lr.last_reading_on, 'YYYY-MM-DD') AS last_reading_on,
       COALESCE(pe.pending_count, 0) AS pending_count,
       pr.prefs,
       w.held_until,
       -- for V_PATIENT_DETAIL (so the costly views are expanded once per request)
       COALESCE(fl.firings, ARRAY_CONSTRUCT())   AS firings,
       fl.held,
       COALESCE(ml.monitored, ARRAY_CONSTRUCT()) AS monitored
FROM PATIENTS p
LEFT JOIN PATIENT_PROFILE pp ON pp.patient_id = p.patient_id
LEFT JOIN win w              ON w.patient_id = p.patient_id
LEFT JOIN notes nt           ON nt.patient_id = p.patient_id
LEFT JOIN dx                 ON dx.patient_id = p.patient_id
LEFT JOIN plan_mode pm       ON pm.patient_id = p.patient_id
LEFT JOIN overrides ov       ON ov.patient_id = p.patient_id
LEFT JOIN todo_counts td     ON td.patient_id = p.patient_id
LEFT JOIN pending pe         ON pe.patient_id = p.patient_id
LEFT JOIN last_reading lr    ON lr.patient_id = p.patient_id
LEFT JOIN prefs pr           ON pr.patient_id = p.patient_id
LEFT JOIN firing_list fl     ON fl.patient_id = p.patient_id
LEFT JOIN monitored_list ml  ON ml.patient_id = p.patient_id;

-- ---------------------------------------------------------------------
-- V_PATIENT_DETAIL: one row per patient. V_PATIENT_LIST columns (incl. its firings, held and monitored),
-- the record header, and nested arrays/objects built in pre-aggregated CTEs.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW V_PATIENT_DETAIL COPY GRANTS AS
WITH goal_notes AS (
  SELECT patient_id,
         MAX(IFF(setting = 'BP_GOAL',  note_id, NULL)) AS bp_goal_note,
         MAX(IFF(setting = 'A1C_GOAL', note_id, NULL)) AS a1c_goal_note
  FROM V_ACTIVE_OVERRIDES
  WHERE setting IN ('BP_GOAL', 'A1C_GOAL')
  GROUP BY patient_id
),
notes AS (
  SELECT patient_id,
         ARRAY_AGG(OBJECT_CONSTRUCT_KEEP_NULL(
                     'note_id', note_id, 'note_date', TO_VARCHAR(note_date, 'YYYY-MM-DD'), 'clinician', clinician,
                     'note_text', note_text, 'has_ai_plan', note_text LIKE '%AI PLAN%'))
           WITHIN GROUP (ORDER BY note_date, note_id) AS notes
  FROM CLINICAL_NOTES
  GROUP BY patient_id
),
overrides AS (   -- every AI Plan line in note order, with Faiz's status
  SELECT o.patient_id,
         ARRAY_AGG(OBJECT_CONSTRUCT_KEEP_NULL(
                     'note_id', o.note_id, 'note_date', TO_VARCHAR(o.note_date, 'YYYY-MM-DD'), 'line', o.line,
                     'raw_key', o.raw_key, 'raw_value', o.raw_value, 'setting', o.setting, 'status', o.status))
           WITHIN GROUP (ORDER BY o.note_date, o.note_id, POSITION(o.line IN n.note_text)) AS overrides
  FROM V_PATIENT_OVERRIDES o
  LEFT JOIN CLINICAL_NOTES n ON n.note_id = o.note_id
  GROUP BY o.patient_id
),
active_overrides AS (
  SELECT patient_id,
         ARRAY_AGG(OBJECT_CONSTRUCT_KEEP_NULL('setting', setting, 'raw_value', raw_value, 'note_id', note_id))
           WITHIN GROUP (ORDER BY setting) AS active_overrides
  FROM V_ACTIVE_OVERRIDES
  GROUP BY patient_id
),
plans AS (   -- latest plan per patient x condition
  SELECT plan_id, patient_id, condition, note_id, mode, status, reading, reading_model, validation, created_at
  FROM CARE_PLANS
  QUALIFY ROW_NUMBER() OVER (PARTITION BY patient_id, condition ORDER BY created_at DESC) = 1
),
plan AS (   -- the patient's most recent plan
  SELECT patient_id,
         OBJECT_CONSTRUCT_KEEP_NULL(
           'plan_id', plan_id, 'condition', condition, 'note_id', note_id, 'mode', mode, 'status', status,
           'reading', reading, 'reading_model', reading_model, 'validation', validation) AS plan
  FROM plans
  QUALIFY ROW_NUMBER() OVER (PARTITION BY patient_id ORDER BY created_at DESC, condition) = 1
),
todo_items AS (   -- named so it does not shadow the TODOS table
  SELECT t.patient_id,
         ARRAY_AGG(OBJECT_CONSTRUCT_KEEP_NULL(
                     'todo_id', t.todo_id, 'plan_id', t.plan_id, 'seq', t.seq, 'todo_text', t.todo_text,
                     'rule_id', t.rule_id, 'setting', t.setting, 'layer', t.layer,
                     'due_on', TO_VARCHAR(t.due_on, 'YYYY-MM-DD'), 'done', COALESCE(t.done, FALSE), 'kind', t.kind,
                     'source', t.source))
           WITHIN GROUP (ORDER BY pl.condition, t.seq) AS todos
  FROM TODOS t
  JOIN plans pl ON pl.plan_id = t.plan_id
  GROUP BY t.patient_id
),
meta AS (
  SELECT action_id, kind, sim_date, layer, model, draft_source, safety_ok, safety_notes
  FROM ACTION_META
  QUALIFY ROW_NUMBER() OVER (PARTITION BY action_id ORDER BY created_at DESC) = 1
),
sends AS (
  SELECT action_id,
         ARRAY_AGG(OBJECT_CONSTRUCT_KEEP_NULL(
                     'msg_id', msg_id, 'channel', channel, 'recipient', recipient, 'payload', payload,
                     'provider', provider, 'sent_at', TO_VARCHAR(sent_at, 'YYYY-MM-DD"T"HH24:MI:SS'),
                     'sent_sim', TO_VARCHAR(sent_sim, 'YYYY-MM-DD')))
           WITHIN GROUP (ORDER BY sent_at, msg_id) AS sends,
         MAX_BY(channel, sent_at) AS channel
  FROM OUTBOX
  GROUP BY action_id
),
actions AS (   -- every action for the patient, newest first, with its simulated sends
  SELECT q.patient_id,
         ARRAY_AGG(OBJECT_CONSTRUCT_KEEP_NULL(
                     'action_id', q.action_id, 'condition', q.condition, 'rule_id', q.rule_id,
                     'kind', COALESCE(m.kind, CASE WHEN r.action_type = 'URGENT_ALERT' THEN 'RED_FLAG'
                                                   WHEN q.rule_id = 'PLAN-REVIEW'     THEN 'PLAN_REVIEW'
                                                   ELSE 'DRAFT' END),
                     'step', r.step, 'action_type', r.action_type, 'recipient', q.recipient,
                     'layer', COALESCE(m.layer, IFF(q.rule_id IN ('HOLD', 'ENG-3H', 'PLAN-REVIEW')
                                                    OR (q.rule_id IN ('BP-1', 'BP-3') AND g.bp_goal_note IS NOT NULL)
                                                    OR (q.rule_id IN ('DM-1', 'DM-2') AND g.a1c_goal_note IS NOT NULL),
                                                    'P2', 'P0')),
                     'evidence', q.evidence, 'patient_prefs', q.patient_prefs, 'draft_text', q.draft_text,
                     'status', q.status, 'channel', s.channel,
                     'created_at', TO_VARCHAR(q.created_at, 'YYYY-MM-DD"T"HH24:MI:SS'),
                     'sim_date', TO_VARCHAR(m.sim_date, 'YYYY-MM-DD'), 'model', m.model,
                     'draft_source', m.draft_source, 'safety_ok', m.safety_ok, 'safety_notes', m.safety_notes,
                     'reviewed_by', q.reviewed_by,
                     'reviewed_at', TO_VARCHAR(q.reviewed_at, 'YYYY-MM-DD"T"HH24:MI:SS'),
                     'review_note', q.review_note,
                     'sends', COALESCE(s.sends, ARRAY_CONSTRUCT())))
           WITHIN GROUP (ORDER BY q.created_at DESC, q.action_id DESC) AS actions
  FROM ACTION_QUEUE q
  LEFT JOIN RULES r      ON r.rule_id = q.rule_id
  LEFT JOIN meta m       ON m.action_id = q.action_id
  LEFT JOIN sends s      ON s.action_id = q.action_id
  LEFT JOIN goal_notes g ON g.patient_id = q.patient_id
  GROUP BY q.patient_id
),
calls AS (
  SELECT patient_id,
         ARRAY_AGG(OBJECT_CONSTRUCT_KEEP_NULL(
                     'call_id', call_id, 'action_id', action_id, 'attempt', attempt, 'outcome', outcome,
                     'transcript', transcript, 'answers', answers, 'rule_id', rule_id,
                     'at_sim', TO_VARCHAR(at_sim, 'YYYY-MM-DD'), 'scenario', scenario, 'model', model,
                     'created_at', TO_VARCHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS')))
           WITHIN GROUP (ORDER BY created_at, attempt) AS calls
  FROM CALL_TRANSCRIPTS
  GROUP BY patient_id
)
SELECT l.patient_id, l.display_name, l.age, l.conditions, l.ai_plan_mode, l.plan_status, l.todos_done, l.todos_total,
       l.current_rule_id, l.current_step, l.rung, l.display_status, l.status_rank, l.status_reason, l.next_visit_on,
       l.last_reading_on, l.pending_count, l.prefs, l.held_until,
       p.has_diabetes, p.has_ckd, p.has_clinical_cvd, p.prevent_10yr_pct, p.a1c_goal,
       pp.doctor_id, pp.ai_call_consent,
       COALESCE(nt.notes, ARRAY_CONSTRUCT())            AS notes,
       COALESCE(ov.overrides, ARRAY_CONSTRUCT())        AS overrides,
       COALESCE(ao.active_overrides, ARRAY_CONSTRUCT()) AS active_overrides,
       pn.plan,
       l.held,
       COALESCE(td.todos, ARRAY_CONSTRUCT())            AS todos,
       l.monitored,
       COALESCE(ac.actions, ARRAY_CONSTRUCT())          AS actions,
       COALESCE(cl.calls, ARRAY_CONSTRUCT())            AS calls,
       l.firings
FROM V_PATIENT_LIST l
JOIN PATIENTS p              ON p.patient_id = l.patient_id
LEFT JOIN PATIENT_PROFILE pp ON pp.patient_id = l.patient_id
LEFT JOIN notes nt           ON nt.patient_id = l.patient_id
LEFT JOIN overrides ov       ON ov.patient_id = l.patient_id
LEFT JOIN active_overrides ao ON ao.patient_id = l.patient_id
LEFT JOIN plan pn            ON pn.patient_id = l.patient_id
LEFT JOIN todo_items td      ON td.patient_id = l.patient_id
LEFT JOIN actions ac         ON ac.patient_id = l.patient_id
LEFT JOIN calls cl           ON cl.patient_id = l.patient_id;

-- ---------------------------------------------------------------------
-- V_APP_STATE: one row for the top bar and demo panel. Queue counts are read from base tables with
-- the same filters as V_QUEUE, so the view compiles in seconds.
-- call_ready = SENT AI check-in calls with no call yet (or whose only call was unanswered and has no
-- follow-up action yet).
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW V_APP_STATE COPY GRANTS AS
WITH fir AS (SELECT patient_id, condition, rule_id, recipient FROM V_RULE_FIRINGS),
meta AS (
  SELECT action_id, kind FROM ACTION_META
  QUALIFY ROW_NUMBER() OVER (PARTITION BY action_id ORDER BY created_at DESC) = 1
),
act AS (   -- is_red_flag exactly as V_QUEUE computes it
  SELECT q.action_id, q.patient_id, q.condition, q.rule_id, q.recipient, q.status, q.created_at,
         (COALESCE(r.action_type = 'URGENT_ALERT', FALSE) OR COALESCE(m.kind = 'CALL_HANDOFF', FALSE)) AS is_red_flag
  FROM ACTION_QUEUE q
  LEFT JOIN RULES r ON r.rule_id = q.rule_id
  LEFT JOIN meta m  ON m.action_id = q.action_id
),
queue_counts AS (   -- the same rows as V_QUEUE (PENDING)
  SELECT COUNT_IF(status = 'PENDING') AS pending_count,
         COUNT_IF(status = 'PENDING' AND is_red_flag) AS red_flag_count
  FROM act
),
latest AS (
  SELECT patient_id, condition, rule_id, status, created_at
  FROM act
  QUALIFY ROW_NUMBER() OVER (PARTITION BY patient_id, condition ORDER BY created_at DESC, action_id DESC) = 1
),
last_call AS (
  SELECT c.patient_id, q.condition, c.outcome, c.created_at
  FROM CALL_TRANSCRIPTS c
  JOIN ACTION_QUEUE q ON q.action_id = c.action_id
  QUALIFY ROW_NUMBER() OVER (PARTITION BY c.patient_id, q.condition ORDER BY c.created_at DESC) = 1
),
plans AS (
  SELECT patient_id, condition, status
  FROM CARE_PLANS
  QUALIFY ROW_NUMBER() OVER (PARTITION BY patient_id, condition ORDER BY created_at DESC) = 1
),
needs_clinician AS (   -- the rank-1 ("Needs clinician") rules of V_PATIENT_LIST; keep the two in step
  SELECT patient_id FROM act
  WHERE (is_red_flag AND status IN ('PENDING', 'APPROVED', 'EDITED')) OR (status = 'PENDING' AND recipient = 'CLINICIAN')
  UNION
  SELECT f.patient_id
  FROM fir f
  LEFT JOIN latest l ON l.patient_id = f.patient_id AND l.condition = f.condition
  WHERE f.recipient = 'CLINICIAN' AND NOT COALESCE(l.rule_id = f.rule_id AND l.status IN ('SENT', 'REJECTED'), FALSE)
  UNION
  SELECT c.patient_id
  FROM last_call c
  LEFT JOIN latest l ON l.patient_id = c.patient_id AND l.condition = c.condition
  WHERE c.outcome = 'ID_FAILED' AND (l.created_at IS NULL OR l.created_at <= c.created_at)
  UNION
  SELECT patient_id FROM plans WHERE status = 'REJECTED'
),
list_counts AS (
  SELECT COUNT(*) AS needs_clinician_count
  FROM needs_clinician n
  JOIN PATIENTS p ON p.patient_id = n.patient_id
),
held_counts AS (   -- the same rows as V_HELD
  SELECT COUNT_IF(rule_id = 'HOLD') AS held_count FROM fir
),
models AS (
  SELECT OBJECT_AGG(LOWER(key), value::VARIANT) AS models
  FROM TETHER_SETTINGS
  WHERE STARTSWITH(key, 'MODEL_') AND NOT STARTSWITH(key, 'MODEL_PARAMS_OK_')
),
roles_mode AS (
  SELECT MAX(value) AS roles_mode FROM TETHER_SETTINGS WHERE key = 'ROLES_MODE'
),
calls_by_action AS (
  SELECT action_id, MAX(created_at) AS last_call_at, MAX_BY(outcome, created_at) AS last_outcome
  FROM CALL_TRANSCRIPTS
  GROUP BY action_id
),
last_action AS (
  SELECT patient_id, MAX(created_at) AS last_action_at FROM ACTION_QUEUE GROUP BY patient_id
),
call_ready AS (
  SELECT ARRAY_AGG(OBJECT_CONSTRUCT_KEEP_NULL('action_id', q.action_id, 'patient_id', q.patient_id))
           WITHIN GROUP (ORDER BY q.action_id) AS call_ready
  FROM ACTION_QUEUE q
  JOIN RULES r ON r.rule_id = q.rule_id
  LEFT JOIN calls_by_action c ON c.action_id = q.action_id
  LEFT JOIN last_action la    ON la.patient_id = q.patient_id
  WHERE q.status = 'SENT' AND r.action_type = 'AI_CHECKIN_CALL'
    AND (c.action_id IS NULL OR (c.last_outcome = 'NO_ANSWER' AND la.last_action_at <= c.last_call_at))
)
SELECT TO_VARCHAR(a.as_of_date, 'YYYY-MM-DD') AS as_of_date,
       COALESCE(qc.pending_count, 0)         AS pending_count,
       COALESCE(qc.red_flag_count, 0)        AS red_flag_count,
       COALESCE(lc.needs_clinician_count, 0) AS needs_clinician_count,
       COALESCE(hc.held_count, 0)            AS held_count,
       COALESCE(rm.roles_mode, 'SIMULATED')       AS roles_mode,
       COALESCE(m.models, OBJECT_CONSTRUCT())     AS models,
       COALESCE(cr.call_ready, ARRAY_CONSTRUCT()) AS call_ready
FROM AS_OF a
CROSS JOIN queue_counts qc
CROSS JOIN list_counts lc
CROSS JOIN held_counts hc
CROSS JOIN models m
CROSS JOIN roles_mode rm
CROSS JOIN call_ready cr;
