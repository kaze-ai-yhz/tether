-- =====================================================================
-- Chronic Care Rules Engine  |  Intelligence at Work Hackathon
-- Snowflake schema, editable rules, synthetic patients, rule evaluation,
-- Claude drafting via Cortex, and a clinician approval gate.
--
-- SYNTHETIC DATA ONLY. No real patients. No diagnosis is made here:
-- every pathway starts from a diagnosis already in DIAGNOSES.
-- Every outbound action is a DRAFT that a clinician must approve.
--
-- Run top to bottom in a Snowsight SQL worksheet.
-- =====================================================================

CREATE DATABASE IF NOT EXISTS CARE_RULES;
CREATE SCHEMA IF NOT EXISTS CARE_RULES.CORE;
USE SCHEMA CARE_RULES.CORE;

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------

-- Evaluation date. Fixed so the demo is repeatable; change to CURRENT_DATE() for live use.
CREATE OR REPLACE TABLE AS_OF (as_of_date DATE);
INSERT INTO AS_OF VALUES ('2026-10-23');

CREATE OR REPLACE TABLE PATIENTS (
    patient_id        VARCHAR PRIMARY KEY,
    age               INTEGER,
    has_diabetes      BOOLEAN,
    has_ckd           BOOLEAN,
    has_clinical_cvd  BOOLEAN,     -- includes prior stroke
    prevent_10yr_pct  FLOAT,       -- PREVENT 10-year CVD risk, entered by clinician
    a1c_goal          FLOAT,       -- individualized, set by clinician (NULL if no diabetes)
    notes             VARCHAR
);

CREATE OR REPLACE TABLE DIAGNOSES (
    patient_id     VARCHAR,
    condition      VARCHAR,        -- HTN | COPD | T2DM
    stage          VARCHAR,        -- HTN: STAGE1 | STAGE2 ; others free text
    diagnosed_on   DATE,
    diagnosed_by   VARCHAR         -- clinician; the system never diagnoses
);

CREATE OR REPLACE TABLE MEDICATIONS (
    patient_id       VARCHAR,
    condition        VARCHAR,
    drug_class       VARCHAR,      -- class only; clinician chooses the drug
    started_on       DATE,
    last_changed_on  DATE,
    active           BOOLEAN
);

-- value1 / value2 by type:
--   BP: systolic / diastolic (mmHg)     SPO2: resting % / -
--   A1C: %                              GLUCOSE: mg/dL
--   EXACERBATION: 1 mild, 2 moderate, 3 severe
--   ADHERENCE: 1 taking as prescribed, 0 missed doses (value2 = 1 if inhaler technique ok)
CREATE OR REPLACE TABLE READINGS (
    patient_id    VARCHAR,
    condition     VARCHAR,
    reading_type  VARCHAR,
    value1        FLOAT,
    value2        FLOAT,
    taken_on      DATE,
    source        VARCHAR          -- HOME_DEVICE | LAB | PATIENT_REPORT
);

-- Editable thresholds. Change a number here and the evaluation changes.
CREATE OR REPLACE TABLE RULES (
    rule_id        VARCHAR PRIMARY KEY,
    condition      VARCHAR,
    step           VARCHAR,
    threshold1     FLOAT,
    threshold2     FLOAT,
    window_days    INTEGER,
    min_readings   INTEGER,
    priority       INTEGER,        -- lower = more urgent
    action_type    VARCHAR,
    recipient      VARCHAR,        -- PATIENT | PRESCRIBER | CLINICIAN | NONE
    citation       VARCHAR
);

CREATE OR REPLACE TABLE ACTION_QUEUE (
    action_id     NUMBER AUTOINCREMENT,
    patient_id    VARCHAR,
    condition     VARCHAR,
    rule_id       VARCHAR,
    recipient     VARCHAR,
    evidence      VARCHAR,
    draft_text    VARCHAR,
    status        VARCHAR DEFAULT 'PENDING',  -- PENDING | APPROVED | EDITED | REJECTED | SENT
    created_at    TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    reviewed_by   VARCHAR,
    reviewed_at   TIMESTAMP_NTZ,
    review_note   VARCHAR
);

CREATE OR REPLACE TABLE AUDIT_LOG (
    logged_at   TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    actor       VARCHAR,
    event       VARCHAR,
    action_id   NUMBER,
    detail      VARCHAR
);

-- ---------------------------------------------------------------------
-- 2. Rules (guideline-sourced; a clinician confirms against full text)
-- ---------------------------------------------------------------------
INSERT INTO RULES VALUES
 ('BP-GOAL',  'HTN',  'Goal',                   130, 80,  30, 12, 90, 'NONE',              'NONE',       '2025 AHA/ACC HBP guideline: goal <130/80'),
 ('BP-RED',   'HTN',  'Red flag',               180, 120,  7,  1,  1, 'URGENT_ALERT',      'CLINICIAN',  '2025 AHA/ACC HBP guideline: severe hypertension >=180/120'),
 ('BP-1',     'HTN',  'Lifestyle trial ended',  130, 80,  30, 12, 20, 'RECOMMEND_START',   'PRESCRIBER', '2025 AHA/ACC: low-risk stage 1, start meds if >=130/80 after 3-6 mo lifestyle'),
 ('BP-1-MIN', 'HTN',  'Lifestyle trial length',  90, 180, NULL, NULL, 0, 'NONE',          'NONE',       '2025 AHA/ACC: lifestyle trial 3-6 months (90-180 days)'),
 ('BP-2',     'HTN',  'Start medication',       7.5, NULL, NULL, NULL, 10, 'RECOMMEND_START', 'PRESCRIBER', '2025 AHA/ACC: meds + lifestyle for stage 2, or stage 1 with DM/CKD/CVD/PREVENT >=7.5%'),
 ('BP-3',     'HTN',  'Titrate or add agent',   130, 80,  30, 12, 20, 'RECOMMEND_TITRATE', 'PRESCRIBER', '2025 AHA/ACC: intensify if not at goal'),
 ('BP-3-MIN', 'HTN',  'Min days after change',   28, NULL, NULL, NULL, 0, 'NONE',          'NONE',       'Team default: reassess about monthly after a change'),
 ('ADH',      'ALL',  'Adherence check-in',     NULL, NULL, 30, NULL, 15, 'ADHERENCE_CHECKIN', 'PATIENT',  'All guidelines: confirm adherence/technique before escalation'),
 ('COPD-2',   'COPD', 'Exacerbation review',      2, NULL, 90, NULL, 20, 'RECOMMEND_REVIEW', 'PRESCRIBER', 'GOLD 2026: one moderate exacerbation prompts escalation review'),
 ('COPD-3',   'COPD', 'Oxygen evaluation',        88, NULL, 14,  3, 10, 'RECOMMEND_O2_EVAL', 'CLINICIAN', 'GOLD 2026: evaluate LTOT if resting SpO2 <=88%'),
 ('DM-1',     'T2DM', 'A1C due',                  90, 180, NULL, NULL, 30, 'LAB_REMINDER',  'PATIENT',    'ADA 2026: A1C every 3 mo if not at goal, at least 2x/yr if at goal'),
 ('DM-2',     'T2DM', 'Above A1C goal',         NULL, NULL, 90, NULL, 20, 'RECOMMEND_INTENSIFY', 'PRESCRIBER', 'ADA 2026: intensify within 3 months if not at goal'),
 ('DM-3',     'T2DM', 'Recurrent level 1 hypo',   70, NULL, 14,  2, 10, 'RECOMMEND_REVIEW', 'CLINICIAN',  'ADA 2026: level 1 hypoglycemia <70 mg/dL'),
 ('DM-RED',   'T2DM', 'Level 2 hypoglycemia',     54, NULL,  7,  1,  1, 'URGENT_ALERT',     'CLINICIAN',  'ADA 2026: level 2 hypoglycemia <54 mg/dL'),
 -- Follow-up and compliance (team defaults, not guideline numbers; tune here)
 -- Expected reading cadence per condition (window_days = a reading is expected at least this often)
 ('CAD-HTN',  'HTN',  'Expected BP cadence',     NULL, NULL,  7, NULL, 0, 'NONE', 'NONE', 'Team default: home BP at least weekly; 2025 AHA/ACC supports home monitoring'),
 ('CAD-COPD', 'COPD', 'Expected SpO2 cadence',   NULL, NULL,  1, NULL, 0, 'NONE', 'NONE', 'Team default: daily resting SpO2 while in monitoring program'),
 ('CAD-T2DM', 'T2DM', 'Expected glucose cadence (insulin only)', NULL, NULL, 3, NULL, 0, 'NONE', 'NONE', 'Team default: home glucose for patients on insulin'),
 -- Escalation ladder: threshold1 = days overdue past the cadence
 ('ENG-1',   'ALL', 'Missed reading: reminder',            2, NULL, NULL, NULL, 28, 'READING_REMINDER',     'PATIENT',   'Team default: remind at 2 days overdue'),
 ('ENG-2',   'ALL', 'Missed reading: reminder + barrier check', 5, NULL, NULL, NULL, 25, 'BARRIER_CHECKIN', 'PATIENT',   'Team default: ask why (no device, forgot, how-to, cost) at 5 days'),
 -- ENG-3: AI voice check-in. Scripted data collection only: discloses it is an AI, needs patient consent on file,
 -- gives no medical advice, and hands off to a human on any symptom, red flag, question or request for a person.
 ('ENG-3',   'ALL', 'Missed reading: AI check-in call',   10, NULL, NULL, NULL, 16, 'AI_CHECKIN_CALL',     'PATIENT',   'Team default: AI voice check-in at 10 days; human handoff on symptoms or request'),
 ('ENG-4',   'ALL', 'At risk of lost to follow-up',       21, NULL, NULL, NULL, 14, 'LOST_TO_FOLLOWUP',    'CLINICIAN', 'Team default: clinician flag and visit offer at 21 days'),
 ('ENG-DEV', 'ALL', 'No working home device',           NULL, NULL,  30, NULL, 12, 'RECOMMEND_DEVICE',    'CLINICIAN', 'Team default: no device means no data; order device or arrange clinic readings');

-- ---------------------------------------------------------------------
-- 3. Synthetic patients (one per test scenario in the runbook)
-- ---------------------------------------------------------------------
INSERT INTO PATIENTS VALUES
 ('SYN-001', 48, FALSE, FALSE, FALSE, 4.0, NULL, 'Stage 1, low risk, lifestyle trial not working'),
 ('SYN-002', 41, FALSE, FALSE, FALSE, 3.0, NULL, 'Stage 1, low risk, at goal on lifestyle'),
 ('SYN-003', 57, FALSE, FALSE, FALSE, 9.0, NULL, 'New stage 2'),
 ('SYN-004', 62, FALSE, FALSE, FALSE, 8.0, NULL, 'On one agent, missed doses'),
 ('SYN-005', 66, FALSE, FALSE, FALSE, 12.0, NULL, 'Severe reading'),
 ('SYN-006', 71, FALSE, FALSE, FALSE, NULL, NULL, 'COPD, low resting SpO2 despite inhaler change'),
 ('SYN-007', 68, FALSE, FALSE, FALSE, NULL, NULL, 'COPD, one moderate exacerbation'),
 ('SYN-008', 55, TRUE,  FALSE, FALSE, NULL, 7.0, 'T2DM above goal on metformin'),
 ('SYN-009', 74, TRUE,  FALSE, FALSE, NULL, 8.0, 'T2DM, glucose 51'),
 ('SYN-010', 50, TRUE,  FALSE, FALSE, NULL, 7.0, 'T2DM at goal, A1C overdue'),
 ('SYN-011', 52, FALSE, FALSE, FALSE, 5.0, NULL, 'Stage 1 lifestyle trial, stopped logging BP 18 days ago'),
 ('SYN-012', 69, FALSE, FALSE, FALSE, NULL, NULL, 'COPD, reports no pulse oximeter at home'),
 ('SYN-013', 63, FALSE, FALSE, FALSE, 9.0, NULL, 'On BP medication, no readings for over a month'),
 ('SYN-014', 45, FALSE, FALSE, FALSE, 6.0, NULL, 'Stage 1, forgot to log BP this week');

INSERT INTO DIAGNOSES VALUES
 ('SYN-001','HTN','STAGE1','2026-06-10','Dr. Synthetic'),
 ('SYN-002','HTN','STAGE1','2026-07-20','Dr. Synthetic'),
 ('SYN-003','HTN','STAGE2','2026-10-15','Dr. Synthetic'),
 ('SYN-004','HTN','STAGE2','2026-08-01','Dr. Synthetic'),
 ('SYN-005','HTN','STAGE2','2026-05-01','Dr. Synthetic'),
 ('SYN-006','COPD','GOLD_E','2025-11-01','Dr. Synthetic'),
 ('SYN-007','COPD','GOLD_B','2025-04-01','Dr. Synthetic'),
 ('SYN-008','T2DM','T2DM','2024-02-01','Dr. Synthetic'),
 ('SYN-009','T2DM','T2DM','2019-06-01','Dr. Synthetic'),
 ('SYN-010','T2DM','T2DM','2023-01-15','Dr. Synthetic'),
 ('SYN-011','HTN','STAGE1','2026-08-01','Dr. Synthetic'),
 ('SYN-012','COPD','GOLD_B','2026-10-01','Dr. Synthetic'),
 ('SYN-013','HTN','STAGE2','2026-04-01','Dr. Synthetic'),
 ('SYN-014','HTN','STAGE1','2026-09-15','Dr. Synthetic');

INSERT INTO MEDICATIONS VALUES
 ('SYN-004','HTN','ACE inhibitor','2026-09-08','2026-09-08',TRUE),
 ('SYN-005','HTN','Fixed-dose combination','2026-05-05','2026-08-01',TRUE),
 ('SYN-006','COPD','LAMA/LABA inhaler','2025-11-05','2026-09-01',TRUE),
 ('SYN-007','COPD','LAMA inhaler','2025-04-05','2025-04-05',TRUE),
 ('SYN-008','T2DM','Metformin','2024-02-10','2025-01-10',TRUE),
 ('SYN-009','T2DM','Basal insulin','2022-03-01','2026-07-01',TRUE),
 ('SYN-010','T2DM','Metformin','2023-01-20','2023-01-20',TRUE),
 ('SYN-012','COPD','LAMA inhaler','2026-10-02','2026-10-02',TRUE),
 ('SYN-013','HTN','Fixed-dose combination','2026-04-05','2026-07-01',TRUE);

-- Home BP: two readings a day for the last 7 days (14 readings) per BP patient.
INSERT INTO READINGS
SELECT p.patient_id, 'HTN', 'BP', p.sys + MOD(n.i, 3) - 1, p.dia + MOD(n.i, 2), DATEADD('day', -FLOOR(n.i / 2), '2026-10-22'::DATE), 'HOME_DEVICE'
FROM (VALUES ('SYN-001',136,84),('SYN-002',126,77),('SYN-003',152,96),('SYN-004',138,86),('SYN-005',158,94)) AS p(patient_id, sys, dia)
CROSS JOIN (VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9),(10),(11),(12),(13)) AS n(i);

-- SYN-005 severe reading
INSERT INTO READINGS VALUES ('SYN-005','HTN','BP',186,122,'2026-10-22','HOME_DEVICE');

-- Adherence reports
INSERT INTO READINGS VALUES
 ('SYN-004','HTN','ADHERENCE',0,NULL,'2026-10-18','PATIENT_REPORT'),
 ('SYN-005','HTN','ADHERENCE',1,NULL,'2026-10-18','PATIENT_REPORT'),
 ('SYN-006','COPD','ADHERENCE',1,1,'2026-10-15','PATIENT_REPORT'),
 ('SYN-007','COPD','ADHERENCE',1,1,'2026-10-15','PATIENT_REPORT'),
 ('SYN-008','T2DM','ADHERENCE',1,NULL,'2026-10-12','PATIENT_REPORT');

-- COPD resting SpO2, daily for 10 days
INSERT INTO READINGS
SELECT p.patient_id, 'COPD', 'SPO2', p.spo2 - MOD(n.i, 2), NULL, DATEADD('day', -n.i, '2026-10-22'::DATE), 'HOME_DEVICE'
FROM (VALUES ('SYN-006',88),('SYN-007',94)) AS p(patient_id, spo2)
CROSS JOIN (VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)) AS n(i);

INSERT INTO READINGS VALUES ('SYN-007','COPD','EXACERBATION',2,NULL,'2026-09-25','PATIENT_REPORT');

-- Follow-up scenarios: stale or missing readings, and a reported barrier
-- BARRIER codes (value1): 1 no working device, 2 forgot, 3 unsure how to measure, 4 cost or access
INSERT INTO READINGS VALUES
 ('SYN-011','HTN','BP',134,84,'2026-10-04','HOME_DEVICE'),
 ('SYN-011','HTN','BP',135,83,'2026-10-05','HOME_DEVICE'),
 ('SYN-012','COPD','BARRIER',1,NULL,'2026-10-20','PATIENT_REPORT'),
 ('SYN-013','HTN','BP',142,88,'2026-09-20','HOME_DEVICE'),
 ('SYN-014','HTN','BP',133,82,'2026-10-13','HOME_DEVICE'),
 ('SYN-014','HTN','BP',132,83,'2026-10-14','HOME_DEVICE');

-- Diabetes labs and glucose
INSERT INTO READINGS VALUES
 ('SYN-008','T2DM','A1C',8.1,NULL,'2026-10-10','LAB'),
 ('SYN-009','T2DM','A1C',7.6,NULL,'2026-09-01','LAB'),
 ('SYN-009','T2DM','GLUCOSE',51,NULL,'2026-10-21','HOME_DEVICE'),
 ('SYN-009','T2DM','GLUCOSE',112,NULL,'2026-10-22','HOME_DEVICE'),
 ('SYN-010','T2DM','A1C',6.6,NULL,'2026-03-15','LAB');

-- ---------------------------------------------------------------------
-- 4. Rule evaluation (thresholds read from RULES, so they stay editable)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW V_RULE_FIRINGS AS
WITH d AS (SELECT as_of_date FROM AS_OF),
r AS (SELECT * FROM RULES),
bp AS (   -- home BP average within the BP-GOAL window
  SELECT x.patient_id, AVG(x.value1) AS avg_sys, AVG(x.value2) AS avg_dia, COUNT(*) AS n
  FROM READINGS x, d, r
  WHERE r.rule_id = 'BP-GOAL' AND x.reading_type = 'BP'
    AND x.taken_on > DATEADD('day', -r.window_days, d.as_of_date)
  GROUP BY x.patient_id
),
adh AS (  -- latest adherence report per patient/condition
  SELECT patient_id, condition, value1 AS adherent, value2 AS technique_ok, taken_on
  FROM READINGS WHERE reading_type = 'ADHERENCE'
  QUALIFY ROW_NUMBER() OVER (PARTITION BY patient_id, condition ORDER BY taken_on DESC) = 1
),
htn AS (
  SELECT dx.patient_id, dx.stage, dx.diagnosed_on, p.prevent_10yr_pct,
         (p.has_diabetes OR p.has_ckd OR p.has_clinical_cvd OR COALESCE(p.prevent_10yr_pct,0) >= (SELECT threshold1 FROM r WHERE rule_id='BP-2')) AS high_risk,
         m.drug_class, m.last_changed_on,
         bp.avg_sys, bp.avg_dia, bp.n, a.adherent
  FROM DIAGNOSES dx
  JOIN PATIENTS p ON p.patient_id = dx.patient_id
  LEFT JOIN MEDICATIONS m ON m.patient_id = dx.patient_id AND m.condition = 'HTN' AND m.active
  LEFT JOIN bp ON bp.patient_id = dx.patient_id
  LEFT JOIN adh a ON a.patient_id = dx.patient_id AND a.condition = 'HTN'
  WHERE dx.condition = 'HTN'
),
goal AS (SELECT threshold1 AS sys, threshold2 AS dia, min_readings AS min_n FROM r WHERE rule_id = 'BP-GOAL'),
-- Follow-up: which home measure each patient is expected to send, and how overdue it is.
-- Missing data is never treated as "at goal": it drives the engagement ladder instead.
monitored AS (
  SELECT dx.patient_id, dx.condition, dx.diagnosed_on,
         CASE dx.condition WHEN 'HTN' THEN 'BP' WHEN 'COPD' THEN 'SPO2' ELSE 'GLUCOSE' END AS reading_type
  FROM DIAGNOSES dx
  WHERE dx.condition IN ('HTN','COPD')
     OR (dx.condition = 'T2DM' AND EXISTS (SELECT 1 FROM MEDICATIONS m
           WHERE m.patient_id = dx.patient_id AND m.condition = 'T2DM' AND m.active AND LOWER(m.drug_class) LIKE '%insulin%'))
),
last_reading AS (
  SELECT patient_id, reading_type, MAX(taken_on) AS last_on FROM READINGS GROUP BY patient_id, reading_type
),
barrier AS (  -- latest barrier report per patient/condition
  SELECT patient_id, condition, value1 AS code, taken_on
  FROM READINGS WHERE reading_type = 'BARRIER'
  QUALIFY ROW_NUMBER() OVER (PARTITION BY patient_id, condition ORDER BY taken_on DESC) = 1
),
eng AS (
  SELECT m.patient_id, m.condition, m.reading_type, lr.last_on, b.code AS barrier_code,
         DATEDIFF('day', COALESCE(lr.last_on, m.diagnosed_on), d.as_of_date) - c.window_days AS days_overdue,
         CASE WHEN b.code = 1 AND b.taken_on > DATEADD('day', -(SELECT window_days FROM r WHERE rule_id='ENG-DEV'), d.as_of_date)
              THEN TRUE ELSE FALSE END AS no_device
  FROM monitored m
  CROSS JOIN d
  JOIN r c ON c.rule_id = 'CAD-' || m.condition
  LEFT JOIN last_reading lr ON lr.patient_id = m.patient_id AND lr.reading_type = m.reading_type
  LEFT JOIN barrier b ON b.patient_id = m.patient_id AND b.condition = m.condition
),
firings AS (
  -- BP red flag
  SELECT x.patient_id, 'HTN' AS condition, 'BP-RED' AS rule_id,
         'BP ' || x.value1::INT || '/' || x.value2::INT || ' on ' || x.taken_on AS evidence
  FROM READINGS x, d, r
  WHERE r.rule_id = 'BP-RED' AND x.reading_type = 'BP'
    AND x.taken_on > DATEADD('day', -r.window_days, d.as_of_date)
    AND (x.value1 >= r.threshold1 OR x.value2 >= r.threshold2)

  UNION ALL
  -- BP-1: low-risk stage 1, lifestyle trial of at least 3 months, still above goal
  SELECT h.patient_id, 'HTN', 'BP-1',
         'Home avg ' || ROUND(h.avg_sys) || '/' || ROUND(h.avg_dia) || ' (' || h.n || ' readings) after ' || DATEDIFF('day', h.diagnosed_on, d.as_of_date) || ' days of lifestyle'
  FROM htn h, d, goal g
  WHERE h.stage = 'STAGE1' AND NOT h.high_risk AND h.drug_class IS NULL
    AND DATEDIFF('day', h.diagnosed_on, d.as_of_date) >= (SELECT threshold1 FROM r WHERE rule_id = 'BP-1-MIN')
    AND h.n >= g.min_n AND (h.avg_sys >= g.sys OR h.avg_dia >= g.dia)

  UNION ALL
  -- BP-2: stage 2, or stage 1 with high risk, not yet on medication
  SELECT h.patient_id, 'HTN', 'BP-2',
         h.stage || CASE WHEN h.high_risk THEN ', high risk' ELSE '' END || ', no BP medication on file'
  FROM htn h
  WHERE h.drug_class IS NULL AND (h.stage = 'STAGE2' OR h.high_risk)

  UNION ALL
  -- BP-3 or adherence check: on medication, past the trial window, above goal
  SELECT h.patient_id, 'HTN', CASE WHEN COALESCE(h.adherent, 1) = 0 THEN 'ADH' ELSE 'BP-3' END,
         'On ' || h.drug_class || ' since change ' || h.last_changed_on || '; home avg ' || ROUND(h.avg_sys) || '/' || ROUND(h.avg_dia)
         || CASE WHEN COALESCE(h.adherent, 1) = 0 THEN '; patient reported missed doses' ELSE '' END
  FROM htn h, d, goal g
  WHERE h.drug_class IS NOT NULL
    AND DATEDIFF('day', h.last_changed_on, d.as_of_date) >= (SELECT threshold1 FROM r WHERE rule_id = 'BP-3-MIN')
    AND h.n >= g.min_n AND (h.avg_sys >= g.sys OR h.avg_dia >= g.dia)

  UNION ALL
  -- COPD-3: repeated resting SpO2 at or below threshold -> oxygen evaluation (not inhaler change)
  SELECT x.patient_id, 'COPD', 'COPD-3',
         COUNT(*) || ' resting SpO2 readings <= ' || MAX(r.threshold1)::INT || '% in ' || MAX(r.window_days) || ' days (lowest ' || MIN(x.value1)::INT || '%)'
  FROM READINGS x, d, r
  WHERE r.rule_id = 'COPD-3' AND x.reading_type = 'SPO2'
    AND x.taken_on > DATEADD('day', -r.window_days, d.as_of_date)
    AND x.value1 <= r.threshold1
  GROUP BY x.patient_id
  HAVING COUNT(*) >= MAX(r.min_readings)

  UNION ALL
  -- COPD-2: moderate or worse exacerbation in window -> review (adherence first)
  SELECT x.patient_id, 'COPD',
         CASE WHEN COALESCE(a.adherent, 1) = 0 OR COALESCE(a.technique_ok, 1) = 0 THEN 'ADH' ELSE 'COPD-2' END,
         'Exacerbation severity ' || x.value1::INT || ' on ' || x.taken_on
  FROM READINGS x
  CROSS JOIN d
  JOIN r ON r.rule_id = 'COPD-2'
  LEFT JOIN adh a ON a.patient_id = x.patient_id AND a.condition = 'COPD'
  WHERE x.reading_type = 'EXACERBATION' AND x.value1 >= r.threshold1
    AND x.taken_on > DATEADD('day', -r.window_days, d.as_of_date)

  UNION ALL
  -- DM-RED: level 2 hypoglycemia
  SELECT x.patient_id, 'T2DM', 'DM-RED', 'Glucose ' || x.value1::INT || ' mg/dL on ' || x.taken_on
  FROM READINGS x, d, r
  WHERE r.rule_id = 'DM-RED' AND x.reading_type = 'GLUCOSE' AND x.value1 < r.threshold1
    AND x.taken_on > DATEADD('day', -r.window_days, d.as_of_date)

  UNION ALL
  -- DM-3: recurrent level 1 hypoglycemia
  SELECT x.patient_id, 'T2DM', 'DM-3', COUNT(*) || ' glucose readings < ' || MAX(r.threshold1)::INT || ' mg/dL'
  FROM READINGS x, d, r
  WHERE r.rule_id = 'DM-3' AND x.reading_type = 'GLUCOSE' AND x.value1 < r.threshold1
    AND x.taken_on > DATEADD('day', -r.window_days, d.as_of_date)
  GROUP BY x.patient_id
  HAVING COUNT(*) >= MAX(r.min_readings)

  UNION ALL
  -- DM-1 / DM-2 from latest A1C
  SELECT l.patient_id, 'T2DM',
         CASE WHEN l.value1 > p.a1c_goal AND DATEDIFF('day', l.taken_on, d.as_of_date) <= (SELECT window_days FROM r WHERE rule_id='DM-2')
                   THEN CASE WHEN COALESCE(a.adherent, 1) = 0 THEN 'ADH' ELSE 'DM-2' END
              ELSE 'DM-1' END,
         'A1C ' || l.value1 || '% on ' || l.taken_on || ' (goal < ' || p.a1c_goal || '%)'
  FROM (SELECT * FROM READINGS WHERE reading_type = 'A1C'
        QUALIFY ROW_NUMBER() OVER (PARTITION BY patient_id ORDER BY taken_on DESC) = 1) l
  CROSS JOIN d
  JOIN PATIENTS p ON p.patient_id = l.patient_id
  LEFT JOIN adh a ON a.patient_id = l.patient_id AND a.condition = 'T2DM'
  WHERE (l.value1 > p.a1c_goal AND DATEDIFF('day', l.taken_on, d.as_of_date) <= (SELECT window_days FROM r WHERE rule_id='DM-2'))
     OR (l.value1 >  p.a1c_goal AND DATEDIFF('day', l.taken_on, d.as_of_date) > (SELECT threshold1 FROM r WHERE rule_id='DM-1'))
     OR (l.value1 <= p.a1c_goal AND DATEDIFF('day', l.taken_on, d.as_of_date) > (SELECT threshold2 FROM r WHERE rule_id='DM-1'))

  UNION ALL
  -- Follow-up ladder: no device -> clinician; otherwise reminder -> barrier check -> call -> lost-to-follow-up flag
  SELECT e.patient_id, e.condition,
         CASE WHEN e.no_device THEN 'ENG-DEV'
              WHEN e.days_overdue >= (SELECT threshold1 FROM r WHERE rule_id='ENG-4') THEN 'ENG-4'
              WHEN e.days_overdue >= (SELECT threshold1 FROM r WHERE rule_id='ENG-3') THEN 'ENG-3'
              WHEN e.days_overdue >= (SELECT threshold1 FROM r WHERE rule_id='ENG-2') THEN 'ENG-2'
              ELSE 'ENG-1' END,
         CASE WHEN e.no_device THEN 'Patient reports no working home device for ' || e.reading_type
              ELSE 'No ' || e.reading_type || ' reading since ' || COALESCE(e.last_on::VARCHAR, 'enrollment')
                   || ' (' || e.days_overdue || ' days overdue)'
                   || CASE e.barrier_code WHEN 2 THEN '; patient said they forgot'
                                          WHEN 3 THEN '; patient unsure how to measure'
                                          WHEN 4 THEN '; cost or access barrier reported' ELSE '' END
         END
  FROM eng e
  WHERE e.no_device OR e.days_overdue >= (SELECT threshold1 FROM r WHERE rule_id='ENG-1')
)
SELECT f.patient_id, f.condition, f.rule_id, r.step, r.action_type, r.recipient, r.priority, f.evidence, r.citation
FROM firings f JOIN RULES r ON r.rule_id = f.rule_id
-- One action per patient per condition: the most urgent wins (red flags beat routine drafts)
QUALIFY ROW_NUMBER() OVER (PARTITION BY f.patient_id, f.condition ORDER BY r.priority) = 1;

-- Check the result: one row per patient that needs action
SELECT * FROM V_RULE_FIRINGS ORDER BY priority, patient_id;

-- ---------------------------------------------------------------------
-- 5. Create drafts (Claude via Cortex) with a duplicate guard
--    Pick a Claude model available in your region:
--    SELECT * FROM TABLE(SNOWFLAKE.CORTEX.LIST_MODELS()) ... or see the
--    "Models and regional availability" doc. Cross-region may be needed:
--    ALTER ACCOUNT SET CORTEX_ENABLED_CROSS_REGION = 'ANY_REGION';
-- ---------------------------------------------------------------------
SET CLAUDE_MODEL = 'claude-sonnet-4-5';   -- replace with the newest Claude model listed in your account

CREATE OR REPLACE PROCEDURE GENERATE_DRAFTS()
RETURNS VARCHAR
LANGUAGE SQL
AS
$$
DECLARE
  n INTEGER;
BEGIN
  INSERT INTO ACTION_QUEUE (patient_id, condition, rule_id, recipient, evidence, draft_text)
  SELECT f.patient_id, f.condition, f.rule_id, f.recipient, f.evidence,
         SNOWFLAKE.CORTEX.AI_COMPLETE(
           $CLAUDE_MODEL,
           'You draft messages for a care team. A clinician will review and approve this draft before anything is sent. '
           || 'Do not diagnose. Do not name a specific drug or dose; refer only to the guideline step. '
           || 'Recipient: ' || f.recipient || '. Action: ' || f.action_type || '. '
           || 'Patient: ' || f.patient_id || ' (synthetic). Condition: ' || f.condition || '. '
           || 'Evidence: ' || f.evidence || '. Rule: ' || f.rule_id || ' ' || f.step || '. Guideline: ' || f.citation || '. '
           || 'Write the draft in under 90 words, then one line starting "Why:" citing the rule and guideline.')
  FROM V_RULE_FIRINGS f
  WHERE NOT EXISTS (   -- duplicate guard: one open draft per patient per condition
    SELECT 1 FROM ACTION_QUEUE q
    WHERE q.patient_id = f.patient_id AND q.condition = f.condition AND q.status IN ('PENDING','APPROVED','EDITED'));
  n := SQLROWCOUNT;
  INSERT INTO AUDIT_LOG (actor, event, detail) VALUES (CURRENT_USER(), 'DRAFTS_GENERATED', :n || ' drafts');
  RETURN :n || ' drafts created';
END;
$$;

-- If $CLAUDE_MODEL is not resolved inside the procedure in your account,
-- paste the model name directly in place of $CLAUDE_MODEL above.

CALL GENERATE_DRAFTS();
SELECT action_id, patient_id, rule_id, recipient, status, draft_text FROM ACTION_QUEUE ORDER BY action_id;

-- ---------------------------------------------------------------------
-- 6. Clinician approval gate
-- ---------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE REVIEW_ACTION(p_action_id NUMBER, p_decision VARCHAR, p_note VARCHAR, p_edited_text VARCHAR)
RETURNS VARCHAR
LANGUAGE SQL
EXECUTE AS OWNER
AS
$$
BEGIN
  IF (p_decision NOT IN ('APPROVED','EDITED','REJECTED')) THEN
    RETURN 'Decision must be APPROVED, EDITED or REJECTED';
  END IF;
  IF (p_decision = 'REJECTED' AND (p_note IS NULL OR p_note = '')) THEN
    RETURN 'A reason is required to reject';
  END IF;
  UPDATE ACTION_QUEUE
     SET status = :p_decision,
         draft_text = COALESCE(:p_edited_text, draft_text),
         reviewed_by = CURRENT_USER(), reviewed_at = CURRENT_TIMESTAMP(), review_note = :p_note
   WHERE action_id = :p_action_id AND status = 'PENDING';
  INSERT INTO AUDIT_LOG (actor, event, action_id, detail)
    VALUES (CURRENT_USER(), :p_decision, :p_action_id, :p_note);
  RETURN 'Action ' || :p_action_id || ' ' || :p_decision;
END;
$$;

-- Only approved or edited drafts are ever eligible to send.
CREATE OR REPLACE VIEW V_READY_TO_SEND AS
SELECT * FROM ACTION_QUEUE WHERE status IN ('APPROVED','EDITED');

-- Example: CALL REVIEW_ACTION(1, 'APPROVED', 'Agree with escalation review', NULL);

-- ---------------------------------------------------------------------
-- 7. Roles (run if your user can create roles; shows governance to judges)
--    The agent can create drafts but cannot approve them.
-- ---------------------------------------------------------------------
-- CREATE ROLE IF NOT EXISTS CARE_AGENT_ROLE;
-- CREATE ROLE IF NOT EXISTS CLINICIAN_ROLE;
-- GRANT USAGE ON DATABASE CARE_RULES TO ROLE CARE_AGENT_ROLE;
-- GRANT USAGE ON DATABASE CARE_RULES TO ROLE CLINICIAN_ROLE;
-- GRANT USAGE ON SCHEMA CARE_RULES.CORE TO ROLE CARE_AGENT_ROLE;
-- GRANT USAGE ON SCHEMA CARE_RULES.CORE TO ROLE CLINICIAN_ROLE;
-- GRANT SELECT ON ALL TABLES IN SCHEMA CARE_RULES.CORE TO ROLE CARE_AGENT_ROLE;
-- GRANT SELECT ON ALL VIEWS IN SCHEMA CARE_RULES.CORE TO ROLE CARE_AGENT_ROLE;
-- GRANT USAGE ON PROCEDURE GENERATE_DRAFTS() TO ROLE CARE_AGENT_ROLE;
-- GRANT SELECT ON ALL TABLES IN SCHEMA CARE_RULES.CORE TO ROLE CLINICIAN_ROLE;
-- GRANT SELECT ON ALL VIEWS IN SCHEMA CARE_RULES.CORE TO ROLE CLINICIAN_ROLE;
-- GRANT USAGE ON PROCEDURE REVIEW_ACTION(NUMBER, VARCHAR, VARCHAR, VARCHAR) TO ROLE CLINICIAN_ROLE;
-- Note: neither role gets UPDATE on ACTION_QUEUE; status changes only through REVIEW_ACTION.
