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
    patient_prefs VARCHAR,        -- language, contact window, channel etc. from the clinician's AI Plan
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
 ('ENG-DEV', 'ALL', 'No working home device',           NULL, NULL,  30, NULL, 12, 'RECOMMEND_DEVICE',    'CLINICIAN', 'Team default: no device means no data; order device or arrange clinic readings'),
 -- Results of the clinician's AI Plan (see section 3b)
 ('ENG-3H',  'ALL', 'Missed reading: human call (AI calls not allowed)', 10, NULL, NULL, NULL, 16, 'CARE_TEAM_CALL', 'CLINICIAN', 'Clinician AI Plan: no AI calls for this patient'),
 ('HOLD',    'ALL', 'Escalation held by clinician',     NULL, NULL, NULL, NULL, 60, 'HELD_BY_CLINICIAN',   'NONE',      'Clinician AI Plan: hold escalation until a date; red flags are never held'),
 ('PLAN-REVIEW','PLAN','AI Plan line needs clinician review', NULL, NULL, NULL, NULL, 5, 'PLAN_REVIEW',   'CLINICIAN', 'Safety rules cannot be overridden; out-of-range or unrecognized lines are not applied');

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
 ('SYN-014', 45, FALSE, FALSE, FALSE, 6.0, NULL, 'Stage 1, forgot to log BP this week'),
 ('SYN-015', 82, FALSE, FALSE, FALSE, 18.0, NULL, 'Stage 2 on medication, falls; clinician set BP goal < 140/90');

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
 ('SYN-014','HTN','STAGE1','2026-09-15','Dr. Synthetic'),
 ('SYN-015','HTN','STAGE2','2025-01-10','Dr. Synthetic');

INSERT INTO MEDICATIONS VALUES
 ('SYN-004','HTN','ACE inhibitor','2026-09-08','2026-09-08',TRUE),
 ('SYN-005','HTN','Fixed-dose combination','2026-05-05','2026-08-01',TRUE),
 ('SYN-006','COPD','LAMA/LABA inhaler','2025-11-05','2026-09-01',TRUE),
 ('SYN-007','COPD','LAMA inhaler','2025-04-05','2025-04-05',TRUE),
 ('SYN-008','T2DM','Metformin','2024-02-10','2025-01-10',TRUE),
 ('SYN-009','T2DM','Basal insulin','2022-03-01','2026-07-01',TRUE),
 ('SYN-010','T2DM','Metformin','2023-01-20','2023-01-20',TRUE),
 ('SYN-012','COPD','LAMA inhaler','2026-10-02','2026-10-02',TRUE),
 ('SYN-013','HTN','Fixed-dose combination','2026-04-05','2026-07-01',TRUE),
 ('SYN-015','HTN','Fixed-dose combination','2025-01-12','2026-08-15',TRUE);

-- Home BP: two readings a day for the last 7 days (14 readings) per BP patient.
INSERT INTO READINGS
SELECT p.patient_id, 'HTN', 'BP', p.sys + MOD(n.i, 3) - 1, p.dia + MOD(n.i, 2), DATEADD('day', -FLOOR(n.i / 2), '2026-10-22'::DATE), 'HOME_DEVICE'
FROM (VALUES ('SYN-001',136,84),('SYN-002',126,77),('SYN-003',152,96),('SYN-004',138,86),('SYN-005',158,94),('SYN-015',136,84)) AS p(patient_id, sys, dia)
CROSS JOIN (VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9),(10),(11),(12),(13)) AS n(i);

-- SYN-005 severe reading
INSERT INTO READINGS VALUES ('SYN-005','HTN','BP',186,122,'2026-10-22','HOME_DEVICE');

-- Adherence reports
INSERT INTO READINGS VALUES
 ('SYN-004','HTN','ADHERENCE',0,NULL,'2026-10-18','PATIENT_REPORT'),
 ('SYN-005','HTN','ADHERENCE',1,NULL,'2026-10-18','PATIENT_REPORT'),
 ('SYN-006','COPD','ADHERENCE',1,1,'2026-10-15','PATIENT_REPORT'),
 ('SYN-007','COPD','ADHERENCE',1,1,'2026-10-15','PATIENT_REPORT'),
 ('SYN-008','T2DM','ADHERENCE',1,NULL,'2026-10-12','PATIENT_REPORT'),
 ('SYN-015','HTN','ADHERENCE',1,NULL,'2026-10-15','PATIENT_REPORT');

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
-- 3b. SOAP notes and the clinician's AI PLAN
--     Each note may end with an "AI PLAN" block of "- Key: value" lines.
--     Those lines become per-patient overrides. The latest signed note wins.
--     Overrides can tighten or customize care, but can never switch off
--     red flags or the approval gate: such lines are SAFETY_BLOCKED and sent
--     to the clinician. Out-of-range values are held for confirmation.
-- ---------------------------------------------------------------------
CREATE OR REPLACE TABLE CLINICAL_NOTES (
    note_id     VARCHAR,
    patient_id  VARCHAR,
    note_date   DATE,
    clinician   VARCHAR,
    note_text   VARCHAR
);

-- Recognized AI Plan keys. Ranges are sanity limits; values outside them wait for confirmation.
CREATE OR REPLACE TABLE OVERRIDE_KEYS (
    key_prefix  VARCHAR,   -- matched against the start of the line's key, lowercase
    setting     VARCHAR,
    value_type  VARCHAR,   -- NUM | BP | DATE | YESNO | TEXT
    min_value   FLOAT,
    max_value   FLOAT,
    min_value2  FLOAT,     -- diastolic range for BP
    max_value2  FLOAT,
    max_days    INTEGER,   -- DATE: latest allowed date after the note
    description VARCHAR
);
INSERT INTO OVERRIDE_KEYS VALUES
 ('a1c goal',              'A1C_GOAL',              'NUM',   6.5, 8.5, NULL, NULL, NULL, 'Individualized A1C goal; ADA: under 7% for many, under 8% less stringent'),
 ('bp goal',               'BP_GOAL',               'BP',    120, 150, 70,   90,   NULL, 'Individualized home BP goal'),
 ('hold escalation',       'HOLD_ESCALATION_UNTIL', 'DATE',  NULL, NULL, NULL, NULL, 180, 'Hold medication escalation drafts until this date; red flags still fire'),
 ('ai calls',              'AI_CALLS',              'YESNO', NULL, NULL, NULL, NULL, NULL, 'Allow AI check-in calls'),
 ('contact window',        'CONTACT_WINDOW',        'TEXT',  NULL, NULL, NULL, NULL, NULL, 'When to contact the patient'),
 ('language',              'LANGUAGE',              'TEXT',  NULL, NULL, NULL, NULL, NULL, 'Language for messages and calls'),
 ('do not contact',        'DO_NOT_CONTACT',        'TEXT',  NULL, NULL, NULL, NULL, NULL, 'People or channels not to contact'),
 ('adherence check-ins',   'CHECKINS',              'TEXT',  NULL, NULL, NULL, NULL, NULL, 'Check-in frequency and channel'),
 ('reminders',             'REMINDER_CHANNEL',      'TEXT',  NULL, NULL, NULL, NULL, NULL, 'Reminder channel'),
 ('notify me directly if', 'NOTIFY_IF',             'TEXT',  NULL, NULL, NULL, NULL, NULL, 'Extra condition for a direct clinician alert (shown on every draft)');

-- Words that mean "weaken a safety rule". Any AI Plan line containing one is blocked.
CREATE OR REPLACE TABLE SAFETY_LOCKED_TERMS (term VARCHAR);
INSERT INTO SAFETY_LOCKED_TERMS VALUES
 ('red flag'), ('only alert'), ('alert only'), ('do not alert'), ('disable'), ('turn off'),
 ('ignore reading'), ('skip approval'), ('no approval'), ('auto-send'), ('without approval');

-- Synthetic SOAP notes (generated by data/gen_notes.py; also in data/soap_notes.csv)
INSERT INTO CLINICAL_NOTES VALUES
 ('N-001','SYN-001','2026-06-10','Dr. Synthetic',$$SOAP NOTE: SYN-001   Date: 2026-06-10   Clinician: Dr. Synthetic

S: 48 y/o man, routine visit. Two elevated office readings this year. One week of home log averages 137/85. No chest pain, headache or vision change.
O: BP 138/86, HR 72, BMI 29.8. Exam unremarkable.
A: Stage 1 hypertension. PREVENT 10-year CVD risk 4%. No diabetes, CKD or CVD.
P: Lifestyle trial: DASH-style eating, sodium reduction, 150 min/week activity, limit alcohol. Home BP twice daily for the week before each review. Review at 3 months.
Signed: Dr. Synthetic   2026-06-10$$),
 ('N-002','SYN-001','2026-08-12','Dr. Synthetic',$$SOAP NOTE: SYN-001   Date: 2026-08-12   Clinician: Dr. Synthetic

S: Walking 3 times a week, cutting salt. Home log average 138/85.
O: BP 136/86, weight down 1.5 kg.
A: Stage 1 hypertension, not at goal on lifestyle.
P: Continue lifestyle trial. Reassess at 4 to 6 months.
Signed: Dr. Synthetic   2026-08-12$$),
 ('N-003','SYN-001','2026-10-02','Dr. Synthetic',$$SOAP NOTE: SYN-001   Date: 2026-10-02   Clinician: Dr. Synthetic

S: Continues home readings. Feels well.
O: BP 136/84, HR 70.
A: Stage 1 hypertension, still above goal after 4 months of lifestyle.
P: If home average remains 130/80 or higher, discuss starting medication at next review.

AI PLAN (clinician directives; supersede the note and rule defaults)
- Contact window: mornings before 10 AM
- Language: English
Signed: Dr. Synthetic   2026-10-02$$),
 ('N-004','SYN-002','2026-07-20','Dr. Synthetic',$$SOAP NOTE: SYN-002   Date: 2026-07-20   Clinician: Dr. Synthetic

S: 41 y/o woman. Elevated readings at work wellness screen. Home log averages 134/83.
O: BP 134/84, BMI 26.1.
A: Stage 1 hypertension. PREVENT 3%.
P: Lifestyle trial with home monitoring. Review at 3 months.
Signed: Dr. Synthetic   2026-07-20$$),
 ('N-005','SYN-002','2026-08-30','Dr. Synthetic',$$SOAP NOTE: SYN-002   Date: 2026-08-30   Clinician: Dr. Synthetic

S: Started cycling, reduced takeout meals.
O: BP 129/79.
A: Stage 1 hypertension, improving.
P: Continue lifestyle trial.
Signed: Dr. Synthetic   2026-08-30$$),
 ('N-006','SYN-002','2026-10-15','Dr. Synthetic',$$SOAP NOTE: SYN-002   Date: 2026-10-15   Clinician: Dr. Synthetic

S: Home log average 126/77 over 7 days.
O: BP 126/78.
A: Stage 1 hypertension, at goal on lifestyle.
P: Continue lifestyle. Home BP weekly. Review in 3 months.
Signed: Dr. Synthetic   2026-10-15$$),
 ('N-007','SYN-003','2025-10-20','Dr. Synthetic',$$SOAP NOTE: SYN-003   Date: 2025-10-20   Clinician: Dr. Synthetic

S: 57 y/o man, annual exam. No complaints.
O: BP 138/88, BMI 30.2.
A: Elevated office BP.
P: Recheck BP, home monitoring advised.
Signed: Dr. Synthetic   2025-10-20$$),
 ('N-008','SYN-003','2026-04-22','Dr. Synthetic',$$SOAP NOTE: SYN-003   Date: 2026-04-22   Clinician: Dr. Synthetic

S: Did not start home monitoring. Occasional morning headaches.
O: BP 146/92.
A: Elevated BP, needs confirmation with home readings.
P: Home BP cuff provided. Log twice daily for a week.
Signed: Dr. Synthetic   2026-04-22$$),
 ('N-009','SYN-003','2026-10-15','Dr. Synthetic',$$SOAP NOTE: SYN-003   Date: 2026-10-15   Clinician: Dr. Synthetic

S: Home log average 152/96 over 7 days.
O: BP 150/96, HR 78.
A: Stage 2 hypertension. PREVENT 9%.
P: Discussed starting medication with lifestyle. Patient wants to talk with his wife first; will decide this week.

AI PLAN (clinician directives; supersede the note and rule defaults)
- Language: Vietnamese
Signed: Dr. Synthetic   2026-10-15$$),
 ('N-010','SYN-004','2026-08-01','Dr. Synthetic',$$SOAP NOTE: SYN-004   Date: 2026-08-01   Clinician: Dr. Synthetic

S: 62 y/o woman. Home log average 148/92.
O: BP 150/92, BMI 28.4.
A: Stage 2 hypertension.
P: Discussed medication and lifestyle. Return in 1 month.
Signed: Dr. Synthetic   2026-08-01$$),
 ('N-011','SYN-004','2026-09-08','Dr. Synthetic',$$SOAP NOTE: SYN-004   Date: 2026-09-08   Clinician: Dr. Synthetic

S: Ready to start medication.
O: BP 146/90.
A: Stage 2 hypertension.
P: Started ACE inhibitor. Home BP twice daily. Recheck 4 to 6 weeks.
Signed: Dr. Synthetic   2026-09-08$$),
 ('N-012','SYN-004','2026-10-06','Dr. Synthetic',$$SOAP NOTE: SYN-004   Date: 2026-10-06   Clinician: Dr. Synthetic

S: Phone visit. Missing doses 2 to 3 times a week; copay is a concern.
O: Home average 138/86.
A: Stage 2 hypertension, not at goal; adherence barrier is cost.
P: Pharmacy to check lower-cost options. Reinforce daily dosing.
Signed: Dr. Synthetic   2026-10-06$$),
 ('N-013','SYN-005','2026-05-01','Dr. Synthetic',$$SOAP NOTE: SYN-005   Date: 2026-05-01   Clinician: Dr. Synthetic

S: 66 y/o man. Home log average 162/98.
O: BP 160/98.
A: Stage 2 hypertension.
P: Started fixed-dose combination. Home monitoring.
Signed: Dr. Synthetic   2026-05-01$$),
 ('N-014','SYN-005','2026-08-01','Dr. Synthetic',$$SOAP NOTE: SYN-005   Date: 2026-08-01   Clinician: Dr. Synthetic

S: Tolerating medication. Home average 156/94.
O: BP 154/94.
A: Stage 2 hypertension, not at goal.
P: Dose increased. Recheck in 4 weeks.
Signed: Dr. Synthetic   2026-08-01$$),
 ('N-015','SYN-005','2026-10-01','Dr. Synthetic',$$SOAP NOTE: SYN-005   Date: 2026-10-01   Clinician: Dr. Synthetic

S: Thinks his home cuff reads high compared with the office.
O: BP 152/92. Home cuff checked against office cuff: within 5 mmHg.
A: Stage 2 hypertension, not at goal. Home cuff is accurate.
P: Continue current regimen, reassess adherence.

AI PLAN (clinician directives; supersede the note and rule defaults)
- Red flag BP: only alert me above 200/130 (patient's cuff reads high)
- AI calls: allowed
Signed: Dr. Synthetic   2026-10-01$$),
 ('N-016','SYN-006','2025-11-01','Dr. Synthetic',$$SOAP NOTE: SYN-006   Date: 2025-11-01   Clinician: Dr. Synthetic

S: 71 y/o woman, former smoker. Spirometry confirmed COPD. Two exacerbations this year.
O: SpO2 92% at rest. Scattered wheeze.
A: COPD, GOLD group E.
P: Started LAMA/LABA inhaler. Inhaler technique taught. Pulmonary rehab referral.
Signed: Dr. Synthetic   2025-11-01$$),
 ('N-017','SYN-006','2026-06-10','Dr. Synthetic',$$SOAP NOTE: SYN-006   Date: 2026-06-10   Clinician: Dr. Synthetic

S: More breathless on stairs.
O: SpO2 90% at rest.
A: COPD, symptomatic.
P: Technique reviewed, good. Home pulse oximeter, log daily.
Signed: Dr. Synthetic   2026-06-10$$),
 ('N-018','SYN-006','2026-09-01','Dr. Synthetic',$$SOAP NOTE: SYN-006   Date: 2026-09-01   Clinician: Dr. Synthetic

S: Home SpO2 88 to 89% at rest most days.
O: SpO2 89% at rest.
A: COPD with low resting SpO2.
P: Regimen adjusted. Continue daily SpO2 logging.

AI PLAN (clinician directives; supersede the note and rule defaults)
- Contact window: afternoons
- AI calls: allowed
Signed: Dr. Synthetic   2026-09-01$$),
 ('N-019','SYN-007','2025-04-01','Dr. Synthetic',$$SOAP NOTE: SYN-007   Date: 2025-04-01   Clinician: Dr. Synthetic

S: 68 y/o man. Spirometry confirmed COPD.
O: SpO2 95%.
A: COPD, GOLD group B.
P: Started LAMA inhaler.
Signed: Dr. Synthetic   2025-04-01$$),
 ('N-020','SYN-007','2026-03-10','Dr. Synthetic',$$SOAP NOTE: SYN-007   Date: 2026-03-10   Clinician: Dr. Synthetic

S: Stable, walking daily.
O: SpO2 95%.
A: COPD, stable.
P: Continue current inhaler.
Signed: Dr. Synthetic   2026-03-10$$),
 ('N-021','SYN-007','2026-09-28','Dr. Synthetic',$$SOAP NOTE: SYN-007   Date: 2026-09-28   Clinician: Dr. Synthetic

S: Moderate exacerbation on 9/25, treated at urgent care with an oral steroid course. Now near baseline. Using inhaler daily.
O: SpO2 94%.
A: COPD after one moderate exacerbation.
P: Review maintenance therapy at follow-up.

AI PLAN (clinician directives; supersede the note and rule defaults)
- AI calls: allowed
- Adherence check-ins: monthly, by phone
Signed: Dr. Synthetic   2026-09-28$$),
 ('N-022','SYN-008','2026-01-12','Dr. Synthetic',$$SOAP NOTE: SYN-008   Date: 2026-01-12   Clinician: Dr. Synthetic

S: 55 y/o man with T2DM on metformin.
O: A1C 7.4%, BMI 31.0.
A: T2DM, near goal.
P: Continue metformin. Recheck A1C 3 to 6 months.
Signed: Dr. Synthetic   2026-01-12$$),
 ('N-023','SYN-008','2026-06-20','Dr. Synthetic',$$SOAP NOTE: SYN-008   Date: 2026-06-20   Clinician: Dr. Synthetic

S: Working night shifts.
O: A1C 7.6%, BP 132/80.
A: T2DM above goal.
P: Diet review. Recheck A1C 3 months.

AI PLAN (clinician directives; supersede the note and rule defaults)
- A1C goal: < 7.0%
- AI calls: allowed
Signed: Dr. Synthetic   2026-06-20$$),
 ('N-024','SYN-008','2026-10-10','Dr. Synthetic',$$SOAP NOTE: SYN-008   Date: 2026-10-10   Clinician: Dr. Synthetic

S: Missing evening doses 2 to 3 times a week due to shift work. No hypoglycemia symptoms. Walking 20 min most days.
O: BP 134/82, BMI 31.4. A1C 8.1%, up from 7.6% in June. Foot exam normal.
A: T2DM above individualized goal. Adherence barrier: shift work.
P: Discussed adherence strategies. Consider intensification if A1C remains above goal after adherence improves. Recheck A1C in 3 months.

AI PLAN (clinician directives; supersede the note and rule defaults)
- A1C goal: < 7.5%
- Hold escalation: until 2026-11-15 (adherence trial first)
- Adherence check-ins: weekly, by text
- Contact window: after 6 PM only
- Language: Spanish
- AI calls: allowed
- Do not contact: family members
- Notify me directly if: home glucose over 300 twice in a week
Signed: Dr. Synthetic   2026-10-10$$),
 ('N-025','SYN-009','2026-03-01','Dr. Synthetic',$$SOAP NOTE: SYN-009   Date: 2026-03-01   Clinician: Dr. Synthetic

S: 74 y/o woman with T2DM on basal insulin.
O: A1C 7.9%.
A: T2DM at individualized goal (< 8%).
P: Continue current insulin dose.
Signed: Dr. Synthetic   2026-03-01$$),
 ('N-026','SYN-009','2026-07-01','Dr. Synthetic',$$SOAP NOTE: SYN-009   Date: 2026-07-01   Clinician: Dr. Synthetic

S: Fasting glucose often over 180.
O: A1C 8.2%.
A: T2DM above goal.
P: Basal insulin dose adjusted. Glucose log every 3 days.
Signed: Dr. Synthetic   2026-07-01$$),
 ('N-027','SYN-009','2026-09-01','Dr. Synthetic',$$SOAP NOTE: SYN-009   Date: 2026-09-01   Clinician: Dr. Synthetic

S: Two mild low-sugar episodes, treated at home.
O: A1C 7.6%.
A: T2DM with mild hypoglycemia.
P: Hypoglycemia education reviewed. Family aware of symptoms.

AI PLAN (clinician directives; supersede the note and rule defaults)
- Notify me directly if: any glucose under 60
Signed: Dr. Synthetic   2026-09-01$$),
 ('N-028','SYN-010','2025-09-10','Dr. Synthetic',$$SOAP NOTE: SYN-010   Date: 2025-09-10   Clinician: Dr. Synthetic

S: 50 y/o man with T2DM on metformin.
O: A1C 6.8%.
A: T2DM at goal.
P: Continue metformin.
Signed: Dr. Synthetic   2025-09-10$$),
 ('N-029','SYN-010','2026-03-15','Dr. Synthetic',$$SOAP NOTE: SYN-010   Date: 2026-03-15   Clinician: Dr. Synthetic

S: Doing well.
O: A1C 6.6%.
A: T2DM at goal.
P: Continue metformin. A1C in 6 months.

AI PLAN (clinician directives; supersede the note and rule defaults)
- A1C goal: < 9.5%
Signed: Dr. Synthetic   2026-03-15$$),
 ('N-030','SYN-010','2026-06-20','Dr. Synthetic',$$SOAP NOTE: SYN-010   Date: 2026-06-20   Clinician: Dr. Synthetic

S: Telehealth for low back strain after lifting.
O: No red flags on history.
A: Mechanical low back pain.
P: Heat, activity as tolerated. Diabetes labs due in September.
Signed: Dr. Synthetic   2026-06-20$$),
 ('N-031','SYN-011','2026-02-14','Dr. Synthetic',$$SOAP NOTE: SYN-011   Date: 2026-02-14   Clinician: Dr. Synthetic

S: 52 y/o woman, annual exam.
O: BP 132/84.
A: Elevated office BP.
P: Home monitoring advised.
Signed: Dr. Synthetic   2026-02-14$$),
 ('N-032','SYN-011','2026-08-01','Dr. Synthetic',$$SOAP NOTE: SYN-011   Date: 2026-08-01   Clinician: Dr. Synthetic

S: Home log average 136/85.
O: BP 136/86, PREVENT 5%.
A: Stage 1 hypertension, low risk.
P: Lifestyle trial with home monitoring. Review at 3 months.
Signed: Dr. Synthetic   2026-08-01$$),
 ('N-033','SYN-011','2026-09-05','Dr. Synthetic',$$SOAP NOTE: SYN-011   Date: 2026-09-05   Clinician: Dr. Synthetic

S: Logging most days. Home average 135/84.
O: BP 134/84.
A: Stage 1 hypertension, lifestyle trial ongoing.
P: Continue.

AI PLAN (clinician directives; supersede the note and rule defaults)
- AI calls: not allowed (prefers to speak with a person)
- Contact window: weekday mornings
Signed: Dr. Synthetic   2026-09-05$$),
 ('N-034','SYN-012','2025-12-03','Dr. Synthetic',$$SOAP NOTE: SYN-012   Date: 2025-12-03   Clinician: Dr. Synthetic

S: 69 y/o man with chronic cough and exertional breathlessness.
O: SpO2 94%.
A: Chronic cough.
P: Spirometry ordered.
Signed: Dr. Synthetic   2025-12-03$$),
 ('N-035','SYN-012','2026-10-01','Dr. Synthetic',$$SOAP NOTE: SYN-012   Date: 2026-10-01   Clinician: Dr. Synthetic

S: Spirometry confirmed COPD.
O: SpO2 93%.
A: COPD, GOLD group B.
P: Started LAMA inhaler. Enrolled in home SpO2 monitoring.
Signed: Dr. Synthetic   2026-10-01$$),
 ('N-036','SYN-012','2026-10-20','Dr. Synthetic',$$SOAP NOTE: SYN-012   Date: 2026-10-20   Clinician: Dr. Synthetic

S: Phone call. Has not been able to buy a pulse oximeter.
O: No home readings.
A: COPD, monitoring not started.
P: Care team to arrange a device.

AI PLAN (clinician directives; supersede the note and rule defaults)
- Language: Mandarin
Signed: Dr. Synthetic   2026-10-20$$),
 ('N-037','SYN-013','2026-04-01','Dr. Synthetic',$$SOAP NOTE: SYN-013   Date: 2026-04-01   Clinician: Dr. Synthetic

S: 63 y/o man. Home log average 158/96.
O: BP 156/96, PREVENT 9%.
A: Stage 2 hypertension.
P: Started fixed-dose combination.
Signed: Dr. Synthetic   2026-04-01$$),
 ('N-038','SYN-013','2026-07-01','Dr. Synthetic',$$SOAP NOTE: SYN-013   Date: 2026-07-01   Clinician: Dr. Synthetic

S: Home average 146/90.
O: BP 144/90.
A: Stage 2 hypertension, not at goal.
P: Dose increased.
Signed: Dr. Synthetic   2026-07-01$$),
 ('N-039','SYN-013','2026-08-05','Dr. Synthetic',$$SOAP NOTE: SYN-013   Date: 2026-08-05   Clinician: Dr. Synthetic

S: Phone visit. Tolerating medication. Busy at work.
O: Home average 142/88.
A: Stage 2 hypertension, improving.
P: Keep logging home BP weekly.

AI PLAN (clinician directives; supersede the note and rule defaults)
- AI calls: allowed
Signed: Dr. Synthetic   2026-08-05$$),
 ('N-040','SYN-014','2025-09-18','Dr. Synthetic',$$SOAP NOTE: SYN-014   Date: 2025-09-18   Clinician: Dr. Synthetic

S: 45 y/o woman, annual exam.
O: BP 128/82.
A: Elevated BP.
P: Recheck next year.
Signed: Dr. Synthetic   2025-09-18$$),
 ('N-041','SYN-014','2026-03-04','Dr. Synthetic',$$SOAP NOTE: SYN-014   Date: 2026-03-04   Clinician: Dr. Synthetic

S: Sinus congestion for 10 days.
O: BP 134/84, afebrile.
A: Acute sinusitis. Elevated BP.
P: Supportive care. Home BP monitoring advised.
Signed: Dr. Synthetic   2026-03-04$$),
 ('N-042','SYN-014','2026-09-15','Dr. Synthetic',$$SOAP NOTE: SYN-014   Date: 2026-09-15   Clinician: Dr. Synthetic

S: Home log average 133/82.
O: BP 134/82, PREVENT 6%.
A: Stage 1 hypertension, low risk.
P: Lifestyle trial with home monitoring.

AI PLAN (clinician directives; supersede the note and rule defaults)
- Reminders: text only
Signed: Dr. Synthetic   2026-09-15$$),
 ('N-043','SYN-015','2025-01-10','Dr. Synthetic',$$SOAP NOTE: SYN-015   Date: 2025-01-10   Clinician: Dr. Synthetic

S: 82 y/o woman. Home log average 156/88.
O: BP 158/88.
A: Stage 2 hypertension.
P: Started fixed-dose combination.
Signed: Dr. Synthetic   2025-01-10$$),
 ('N-044','SYN-015','2026-04-08','Dr. Synthetic',$$SOAP NOTE: SYN-015   Date: 2026-04-08   Clinician: Dr. Synthetic

S: Dizzy when standing up quickly.
O: BP 142/86 seated, 128/80 standing.
A: Stage 2 hypertension with orthostatic symptoms.
P: Hydration and slow position changes. Continue regimen.
Signed: Dr. Synthetic   2026-04-08$$),
 ('N-045','SYN-015','2026-08-15','Dr. Synthetic',$$SOAP NOTE: SYN-015   Date: 2026-08-15   Clinician: Dr. Synthetic

S: Fall at home in July, no injury. Still lightheaded on standing.
O: BP 136/84 seated, 122/76 standing.
A: Stage 2 hypertension with orthostatic hypotension and fall risk.
P: Dose reduced. Physical therapy for balance. Individualized BP goal set.

AI PLAN (clinician directives; supersede the note and rule defaults)
- BP goal: < 140/90 (age 82, orthostatic dizziness, fall in July 2026)
- AI calls: allowed
Signed: Dr. Synthetic   2026-08-15$$);

-- Every AI Plan line, parsed and checked
CREATE OR REPLACE VIEW V_PATIENT_OVERRIDES AS
WITH sec AS (
  SELECT note_id, patient_id, note_date, clinician,
         SPLIT_PART(SPLIT_PART(note_text, 'AI PLAN', 2), 'Signed:', 1) AS section
  FROM CLINICAL_NOTES
  WHERE note_text LIKE '%AI PLAN%'
),
lines AS (
  SELECT s.note_id, s.patient_id, s.note_date, s.clinician, TRIM(t.value) AS line
  FROM sec s, LATERAL SPLIT_TO_TABLE(s.section, '\n') t
),
kv AS (
  SELECT note_id, patient_id, note_date, clinician, line,
         LOWER(TRIM(SUBSTR(line, 3, POSITION(':' IN line) - 3))) AS raw_key,
         TRIM(SUBSTR(line, POSITION(':' IN line) + 1))           AS raw_value
  FROM lines
  WHERE line LIKE '- %' AND POSITION(':' IN line) > 0
),
safety AS (
  SELECT kv.note_id, kv.line, COUNT(*) AS hits
  FROM kv JOIN SAFETY_LOCKED_TERMS s
    ON LOWER(kv.raw_key || ' ' || kv.raw_value) LIKE '%' || s.term || '%'
  GROUP BY kv.note_id, kv.line
),
parsed AS (
  SELECT kv.*, k.setting, k.value_type, k.min_value, k.max_value, k.min_value2, k.max_value2, k.max_days,
         COALESCE(sf.hits, 0) > 0 AS safety_hit,
         TRY_CAST(REGEXP_SUBSTR(kv.raw_value, '[0-9]+[.]?[0-9]*') AS FLOAT)                   AS num1,
         TRY_CAST(REGEXP_SUBSTR(SPLIT_PART(kv.raw_value, '/', 2), '[0-9]+') AS FLOAT)        AS num2,
         TRY_CAST(REGEXP_SUBSTR(kv.raw_value, '[0-9]{4}-[0-9]{2}-[0-9]{2}') AS DATE)         AS date1,
         CASE WHEN LOWER(kv.raw_value) LIKE 'no%' THEN 'N'
              WHEN LOWER(kv.raw_value) LIKE 'allowed%' OR LOWER(kv.raw_value) LIKE 'yes%' THEN 'Y' END AS yn
  FROM kv
  LEFT JOIN OVERRIDE_KEYS k ON kv.raw_key LIKE k.key_prefix || '%'
  LEFT JOIN safety sf ON sf.note_id = kv.note_id AND sf.line = kv.line
)
SELECT note_id, patient_id, note_date, clinician, line, raw_key, raw_value, setting, value_type,
       num1, num2, date1, yn,
       CASE
         WHEN safety_hit THEN 'SAFETY_BLOCKED'
         WHEN setting IS NULL THEN 'UNRECOGNIZED'
         WHEN value_type = 'NUM'   AND (num1 IS NULL OR num1 < min_value OR num1 > max_value) THEN 'NEEDS_CONFIRMATION'
         WHEN value_type = 'BP'    AND (num1 IS NULL OR num2 IS NULL OR num1 < min_value OR num1 > max_value
                                        OR num2 < min_value2 OR num2 > max_value2) THEN 'NEEDS_CONFIRMATION'
         WHEN value_type = 'DATE'  AND (date1 IS NULL OR date1 < note_date OR date1 > DATEADD('day', max_days, note_date)) THEN 'NEEDS_CONFIRMATION'
         WHEN value_type = 'YESNO' AND yn IS NULL THEN 'NEEDS_CONFIRMATION'
         ELSE 'APPLIED'
       END AS status
FROM parsed;

-- The override in force for each patient and setting: the latest signed, applied line
CREATE OR REPLACE VIEW V_ACTIVE_OVERRIDES AS
SELECT patient_id, setting, raw_value, num1, num2, date1, yn, note_id, note_date, clinician
FROM V_PATIENT_OVERRIDES
WHERE status = 'APPLIED'
QUALIFY ROW_NUMBER() OVER (PARTITION BY patient_id, setting ORDER BY note_date DESC, note_id DESC) = 1;

SELECT * FROM V_PATIENT_OVERRIDES ORDER BY patient_id, note_date;

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
ov AS (SELECT * FROM V_ACTIVE_OVERRIDES),   -- clinician AI Plan, latest signed note wins
htn AS (
  SELECT dx.patient_id, dx.stage, dx.diagnosed_on, p.prevent_10yr_pct,
         (p.has_diabetes OR p.has_ckd OR p.has_clinical_cvd OR COALESCE(p.prevent_10yr_pct,0) >= (SELECT threshold1 FROM r WHERE rule_id='BP-2')) AS high_risk,
         m.drug_class, m.last_changed_on,
         bp.avg_sys, bp.avg_dia, bp.n, a.adherent,
         -- individualized goal from the AI Plan, else the guideline goal
         COALESCE(og.num1, (SELECT threshold1 FROM r WHERE rule_id='BP-GOAL')) AS goal_sys,
         COALESCE(og.num2, (SELECT threshold2 FROM r WHERE rule_id='BP-GOAL')) AS goal_dia
  FROM DIAGNOSES dx
  JOIN PATIENTS p ON p.patient_id = dx.patient_id
  LEFT JOIN MEDICATIONS m ON m.patient_id = dx.patient_id AND m.condition = 'HTN' AND m.active
  LEFT JOIN bp ON bp.patient_id = dx.patient_id
  LEFT JOIN adh a ON a.patient_id = dx.patient_id AND a.condition = 'HTN'
  LEFT JOIN ov og ON og.patient_id = dx.patient_id AND og.setting = 'BP_GOAL'
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
    AND h.n >= g.min_n AND (h.avg_sys >= h.goal_sys OR h.avg_dia >= h.goal_dia)

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
         || ' (goal < ' || h.goal_sys || '/' || h.goal_dia || ')'
         || CASE WHEN COALESCE(h.adherent, 1) = 0 THEN '; patient reported missed doses' ELSE '' END
  FROM htn h, d, goal g
  WHERE h.drug_class IS NOT NULL
    AND DATEDIFF('day', h.last_changed_on, d.as_of_date) >= (SELECT threshold1 FROM r WHERE rule_id = 'BP-3-MIN')
    AND h.n >= g.min_n AND (h.avg_sys >= h.goal_sys OR h.avg_dia >= h.goal_dia)

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
         CASE WHEN l.value1 > l.goal AND DATEDIFF('day', l.taken_on, d.as_of_date) <= (SELECT window_days FROM r WHERE rule_id='DM-2')
                   THEN CASE WHEN COALESCE(a.adherent, 1) = 0 THEN 'ADH' ELSE 'DM-2' END
              ELSE 'DM-1' END,
         'A1C ' || l.value1 || '% on ' || l.taken_on || ' (goal < ' || l.goal || '%)'
  FROM (SELECT x.*, COALESCE(oa.num1, p.a1c_goal) AS goal   -- AI Plan goal, else the goal on file
        FROM READINGS x
        JOIN PATIENTS p ON p.patient_id = x.patient_id
        LEFT JOIN ov oa ON oa.patient_id = x.patient_id AND oa.setting = 'A1C_GOAL'
        WHERE x.reading_type = 'A1C'
        QUALIFY ROW_NUMBER() OVER (PARTITION BY x.patient_id ORDER BY x.taken_on DESC) = 1) l
  CROSS JOIN d
  LEFT JOIN adh a ON a.patient_id = l.patient_id AND a.condition = 'T2DM'
  WHERE (l.value1 > l.goal AND DATEDIFF('day', l.taken_on, d.as_of_date) <= (SELECT window_days FROM r WHERE rule_id='DM-2'))
     OR (l.value1 >  l.goal AND DATEDIFF('day', l.taken_on, d.as_of_date) > (SELECT threshold1 FROM r WHERE rule_id='DM-1'))
     OR (l.value1 <= l.goal AND DATEDIFF('day', l.taken_on, d.as_of_date) > (SELECT threshold2 FROM r WHERE rule_id='DM-1'))

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

  UNION ALL
  -- AI Plan lines that were not applied go to the clinician
  SELECT o.patient_id, 'PLAN', 'PLAN-REVIEW',
         'Note ' || o.note_id || ' (' || o.note_date || '): "' || o.line || '" was ' || o.status
         || CASE o.status WHEN 'SAFETY_BLOCKED' THEN '; red flags and the approval gate cannot be overridden'
                          WHEN 'NEEDS_CONFIRMATION' THEN '; value outside the expected range, not applied'
                          ELSE '; key not recognized, not applied' END
  FROM V_PATIENT_OVERRIDES o
  WHERE o.status <> 'APPLIED'
),
-- Apply the clinician's AI Plan: hold escalations, and swap AI calls for a human call when not allowed
adjusted AS (
  SELECT f.patient_id, f.condition,
         CASE WHEN f.rule_id IN ('BP-1','BP-2','BP-3','COPD-2','COPD-3','DM-2') AND oh.date1 > d.as_of_date THEN 'HOLD'
              WHEN f.rule_id = 'ENG-3' AND oc.yn = 'N' THEN 'ENG-3H'
              ELSE f.rule_id END AS rule_id,
         f.evidence
         || CASE WHEN f.rule_id IN ('BP-1','BP-2','BP-3','COPD-2','COPD-3','DM-2') AND oh.date1 > d.as_of_date
                 THEN '; would fire ' || f.rule_id || ', held until ' || oh.date1 || ' per note ' || oh.note_id
                 WHEN f.rule_id = 'ENG-3' AND oc.yn = 'N'
                 THEN '; AI calls not allowed per note ' || oc.note_id ELSE '' END AS evidence
  FROM firings f
  CROSS JOIN d
  LEFT JOIN ov oh ON oh.patient_id = f.patient_id AND oh.setting = 'HOLD_ESCALATION_UNTIL'
  LEFT JOIN ov oc ON oc.patient_id = f.patient_id AND oc.setting = 'AI_CALLS'
),
prefs AS (   -- contact preferences passed to Claude when it drafts
  SELECT patient_id, LISTAGG(setting || ': ' || raw_value, '; ') AS patient_prefs
  FROM ov
  WHERE setting IN ('LANGUAGE','CONTACT_WINDOW','DO_NOT_CONTACT','CHECKINS','REMINDER_CHANNEL','NOTIFY_IF','AI_CALLS')
  GROUP BY patient_id
)
SELECT f.patient_id, f.condition, f.rule_id, r.step, r.action_type, r.recipient, r.priority, f.evidence, r.citation, pr.patient_prefs
FROM adjusted f
JOIN RULES r ON r.rule_id = f.rule_id
LEFT JOIN prefs pr ON pr.patient_id = f.patient_id
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
  INSERT INTO ACTION_QUEUE (patient_id, condition, rule_id, recipient, evidence, patient_prefs, draft_text)
  SELECT f.patient_id, f.condition, f.rule_id, f.recipient, f.evidence, f.patient_prefs,
         SNOWFLAKE.CORTEX.AI_COMPLETE(
           $CLAUDE_MODEL,
           'You draft messages for a care team. A clinician will review and approve this draft before anything is sent. '
           || 'Do not diagnose. Do not name a specific drug or dose; refer only to the guideline step. '
           || 'Recipient: ' || f.recipient || '. Action: ' || f.action_type || '. '
           || 'Patient: ' || f.patient_id || ' (synthetic). Condition: ' || f.condition || '. '
           || 'Evidence: ' || f.evidence || '. Rule: ' || f.rule_id || ' ' || f.step || '. Guideline: ' || f.citation || '. '
           || 'Clinician preferences for this patient (follow them; write in the stated language for patient messages): '
           || COALESCE(f.patient_prefs, 'none') || '. '
           || 'Write the draft in under 90 words, then one line starting "Why:" citing the rule and guideline.')
  FROM V_RULE_FIRINGS f
  WHERE f.recipient <> 'NONE'   -- held items stay visible in V_RULE_FIRINGS but are not drafted
    AND NOT EXISTS (   -- duplicate guard: one open draft per patient per condition
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
