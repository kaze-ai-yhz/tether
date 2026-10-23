-- =====================================================================
-- Ask: semantic view CARE_RULES.CORE.TETHER_ANALYTICS for the Cortex Agent TETHER_ASK (sql/80_agent.sql).
-- Read only. Logical tables over Faiz's objects and the Tether tables RULE_EDITS and PATIENT_PROFILE.
-- PATIENT_PROFILE.display_name is left out on purpose: names never reach the agent or the model.
-- Idempotent: CREATE OR REPLACE; grants are repeated in sql/80_agent.sql.
-- =====================================================================
USE SCHEMA CARE_RULES.CORE;

CREATE OR REPLACE SEMANTIC VIEW CARE_RULES.CORE.TETHER_ANALYTICS
  TABLES (
    patients AS CARE_RULES.CORE.PATIENTS
      PRIMARY KEY (patient_id)
      WITH SYNONYMS ('patient', 'SYN id')
      COMMENT = 'Synthetic patients SYN-001 to SYN-015 with risk flags and the clinician-set A1C goal',
    diagnoses AS CARE_RULES.CORE.DIAGNOSES
      PRIMARY KEY (patient_id, condition)
      WITH SYNONYMS ('conditions', 'diagnosis')
      COMMENT = 'Clinician-made diagnoses: HTN (hypertension), COPD, T2DM (type 2 diabetes). The system never diagnoses',
    readings AS CARE_RULES.CORE.READINGS
      WITH SYNONYMS ('home readings', 'measurements', 'labs')
      COMMENT = 'Home and lab readings. reading_type BP (value1 systolic, value2 diastolic), SPO2 (percent), A1C (percent), GLUCOSE (mg/dL), ADHERENCE, EXACERBATION, BARRIER',
    rules AS CARE_RULES.CORE.RULES
      PRIMARY KEY (rule_id)
      WITH SYNONYMS ('guideline rules', 'thresholds')
      COMMENT = 'Guideline rules and team defaults. Thresholds are rows here; ENG-1 to ENG-4 are the missed-reading ladder (threshold1 = days overdue)',
    firings AS CARE_RULES.CORE.V_RULE_FIRINGS
      PRIMARY KEY (patient_id, condition)
      WITH SYNONYMS ('rule firings', 'current firings', 'alerts', 'what fired')
      COMMENT = 'Current rule firings at the simulated clock: one row per patient and condition, the most urgent rule wins. Includes the missed-reading ladder with days overdue, red flags, held escalations and AI Plan reviews',
    drafts AS CARE_RULES.CORE.ACTION_QUEUE
      PRIMARY KEY (action_id)
      WITH SYNONYMS ('action queue', 'approval queue', 'queue', 'draft actions')
      COMMENT = 'Drafted next steps waiting for a clinician. Nothing is sent unless status is APPROVED or EDITED',
    rule_edits AS CARE_RULES.CORE.RULE_EDITS
      PRIMARY KEY (edit_id)
      WITH SYNONYMS ('threshold edits', 'rule changes')
      COMMENT = 'Threshold edits made by a clinician through UPDATE_RULE, with the reason and which firings changed',
    profiles AS CARE_RULES.CORE.PATIENT_PROFILE
      PRIMARY KEY (patient_id)
      WITH SYNONYMS ('patient profile', 'contact settings')
      COMMENT = 'Care-team settings per patient: doctor, next visit, AI call consent. Patient names are not included'
  )
  RELATIONSHIPS (
    diagnoses_to_patients AS diagnoses (patient_id) REFERENCES patients,
    readings_to_patients  AS readings (patient_id) REFERENCES patients,
    firings_to_patients   AS firings (patient_id) REFERENCES patients,
    firings_to_rules      AS firings (rule_id) REFERENCES rules,
    drafts_to_patients    AS drafts (patient_id) REFERENCES patients,
    drafts_to_rules       AS drafts (rule_id) REFERENCES rules,
    edits_to_rules        AS rule_edits (rule_id) REFERENCES rules,
    profiles_to_patients  AS profiles (patient_id) REFERENCES patients
  )
  FACTS (
    patients.prevent_risk_pct AS prevent_10yr_pct
      COMMENT = 'PREVENT 10-year cardiovascular risk in percent, entered by the clinician',
    readings.reading_value AS value1
      COMMENT = 'Reading value; systolic for BP',
    readings.reading_value2 AS value2
      COMMENT = 'Second reading value; diastolic for BP',
    firings.overdue_days_value AS TRY_TO_NUMBER(REGEXP_SUBSTR(evidence, '[(]([0-9]+) days overdue[)]', 1, 1, 'e', 1))
      COMMENT = 'Days past the expected reading cadence, parsed from the firing evidence'
  )
  DIMENSIONS (
    patients.patient_id AS patient_id
      WITH SYNONYMS ('patient id', 'SYN id')
      COMMENT = 'Synthetic patient id such as SYN-006',
    patients.age AS age,
    patients.has_diabetes AS has_diabetes,
    patients.has_ckd AS has_ckd
      COMMENT = 'Chronic kidney disease on record',
    patients.has_clinical_cvd AS has_clinical_cvd
      COMMENT = 'Clinical cardiovascular disease on record, including prior stroke',
    patients.a1c_goal AS a1c_goal
      COMMENT = 'Individualized A1C goal in percent set by the clinician; NULL without diabetes',

    diagnoses.condition AS condition
      WITH SYNONYMS ('diagnosis', 'disease')
      COMMENT = 'HTN, COPD or T2DM',
    diagnoses.stage AS stage
      COMMENT = 'HTN stage (STAGE1, STAGE2); free text for other conditions',
    diagnoses.diagnosed_on AS diagnosed_on,

    readings.reading_patient_id AS patient_id,
    readings.reading_condition AS condition,
    readings.reading_type AS reading_type
      WITH SYNONYMS ('measure', 'SpO2', 'oxygen saturation', 'blood pressure', 'A1C', 'glucose')
      COMMENT = 'BP, SPO2, A1C, GLUCOSE, ADHERENCE, EXACERBATION or BARRIER',
    readings.taken_on AS taken_on
      WITH SYNONYMS ('reading date', 'last reading')
      COMMENT = 'Date the reading was taken',
    readings.reading_source AS source
      COMMENT = 'HOME_DEVICE, LAB or PATIENT_REPORT',

    rules.rule_id AS rule_id
      WITH SYNONYMS ('rule')
      COMMENT = 'Rule id such as BP-3, COPD-3, DM-RED, ENG-2',
    rules.rule_condition AS condition,
    rules.rule_step AS step
      COMMENT = 'Pathway step name',
    rules.threshold1 AS threshold1
      WITH SYNONYMS ('threshold', 'cutoff')
      COMMENT = 'First threshold (for example systolic, SpO2 percent, glucose mg/dL or days overdue)',
    rules.threshold2 AS threshold2
      COMMENT = 'Second threshold (for example diastolic)',
    rules.window_days AS window_days
      COMMENT = 'Look-back window or expected cadence in days',
    rules.min_readings AS min_readings
      COMMENT = 'Minimum readings before the rule can fire',
    rules.rule_priority AS priority
      COMMENT = 'Lower is more urgent',
    rules.rule_action_type AS action_type,
    rules.rule_recipient AS recipient,
    rules.citation AS citation
      WITH SYNONYMS ('guideline', 'source')
      COMMENT = 'Guideline or team-default source of the rule',

    firings.firing_patient_id AS patient_id,
    firings.firing_condition AS condition,
    firings.firing_rule_id AS rule_id,
    firings.firing_step AS step,
    firings.firing_action_type AS action_type,
    firings.firing_recipient AS recipient
      COMMENT = 'PATIENT, PRESCRIBER, CLINICIAN, or NONE when held',
    firings.firing_priority AS priority,
    firings.firing_evidence AS evidence
      WITH SYNONYMS ('why', 'reason')
      COMMENT = 'Plain-language evidence for the firing, built from the readings',
    firings.firing_citation AS citation,
    firings.overdue_measure AS COALESCE(REGEXP_SUBSTR(evidence, 'No ([A-Z0-9]+) reading since', 1, 1, 'e', 1),
                                        REGEXP_SUBSTR(evidence, 'no working home device for ([A-Z0-9]+)', 1, 1, 'e', 1))
      WITH SYNONYMS ('missed measure', 'overdue reading type')
      COMMENT = 'Reading type (BP, SPO2, GLUCOSE) that is overdue or cannot be sent; NULL when the firing is not about missing readings',
    firings.days_overdue AS TRY_TO_NUMBER(REGEXP_SUBSTR(evidence, '[(]([0-9]+) days overdue[)]', 1, 1, 'e', 1))
      WITH SYNONYMS ('overdue', 'days late', 'missed readings')
      COMMENT = 'Days past the expected reading cadence on the missed-reading ladder (ENG-1 at 2, ENG-2 at 5, ENG-3 at 10, ENG-4 at 21)',
    firings.is_red_flag AS action_type = 'URGENT_ALERT'
      WITH SYNONYMS ('red flag', 'urgent', 'urgent alert')
      COMMENT = 'TRUE for red flags that go to the clinician immediately',
    firings.is_held AS rule_id = 'HOLD'
      WITH SYNONYMS ('held', 'on hold', 'escalation held')
      COMMENT = 'TRUE when the clinician held an escalation in the AI Plan',

    drafts.action_id AS action_id
      WITH SYNONYMS ('draft id')
      COMMENT = 'Draft id in the approval queue',
    drafts.draft_patient_id AS patient_id,
    drafts.draft_condition AS condition,
    drafts.draft_rule_id AS rule_id,
    drafts.draft_recipient AS recipient
      COMMENT = 'Who receives the draft once approved: PATIENT, PRESCRIBER or CLINICIAN',
    drafts.draft_evidence AS evidence
      WITH SYNONYMS ('why', 'reason')
      COMMENT = 'Evidence that made the rule fire',
    drafts.status AS status
      WITH SYNONYMS ('draft status', 'pending', 'waiting', 'approved', 'rejected', 'review status')
      COMMENT = 'PENDING (waiting for a clinician), APPROVED, EDITED, REJECTED or SENT',
    drafts.is_waiting AS status = 'PENDING'
      WITH SYNONYMS ('waiting', 'pending', 'needs review', 'awaiting approval')
      COMMENT = 'TRUE while the draft waits for a clinician decision',
    drafts.created_at AS created_at
      COMMENT = 'When the draft was created',
    drafts.reviewed_by AS reviewed_by,
    drafts.reviewed_at AS reviewed_at,
    drafts.review_note AS review_note
      COMMENT = 'Clinician note given with the decision',

    rule_edits.edit_id AS edit_id,
    rule_edits.edit_rule_id AS rule_id,
    rule_edits.edited_field AS field
      COMMENT = 'threshold1, threshold2, window_days or min_readings',
    rule_edits.old_value AS old_value,
    rule_edits.new_value AS new_value,
    rule_edits.edit_reason AS reason
      COMMENT = 'Reason the clinician gave for the edit',
    rule_edits.edited_by AS edited_by,
    rule_edits.edited_at AS edited_at
      WITH SYNONYMS ('last edit', 'latest edit', 'when edited')
      COMMENT = 'When the edit was made; the latest edit has the greatest value',
    rule_edits.edit_impact AS TO_VARCHAR(impact)
      WITH SYNONYMS ('what changed', 'impact')
      COMMENT = 'JSON list of rule firings that changed because of the edit',

    profiles.profile_patient_id AS patient_id,
    profiles.doctor_id AS doctor_id,
    profiles.next_visit_on AS next_visit_on
      WITH SYNONYMS ('next visit', 'next appointment'),
    profiles.ai_call_consent AS ai_call_consent
      COMMENT = 'Consent on file for simulated AI check-in calls',
    profiles.phone_ok AS phone_ok
  )
  METRICS (
    patients.patient_count AS COUNT(patients.patient_id)
      COMMENT = 'Number of patients',
    readings.reading_count AS COUNT(readings.taken_on)
      COMMENT = 'Number of readings',
    readings.last_reading_on AS MAX(readings.taken_on)
      WITH SYNONYMS ('most recent reading', 'latest reading date')
      COMMENT = 'Date of the most recent reading',
    firings.firing_count AS COUNT(firings.firing_rule_id)
      COMMENT = 'Number of current rule firings',
    firings.red_flag_count AS SUM(IFF(firings.firing_action_type = 'URGENT_ALERT', 1, 0))
      WITH SYNONYMS ('red flags', 'urgent alerts')
      COMMENT = 'Number of current red flags',
    firings.max_days_overdue AS MAX(firings.overdue_days_value)
      COMMENT = 'Largest number of days overdue',
    drafts.draft_count AS COUNT(drafts.action_id)
      COMMENT = 'Number of drafts in the approval queue',
    drafts.waiting_count AS SUM(IFF(drafts.status = 'PENDING', 1, 0))
      WITH SYNONYMS ('pending drafts', 'waiting drafts', 'drafts waiting')
      COMMENT = 'Drafts waiting for a clinician decision',
    drafts.approved_count AS SUM(IFF(drafts.status IN ('APPROVED', 'EDITED'), 1, 0))
      WITH SYNONYMS ('approved drafts')
      COMMENT = 'Drafts a clinician approved or edited',
    rule_edits.edit_count AS COUNT(rule_edits.edit_id)
      COMMENT = 'Number of threshold edits'
  )
  COMMENT = 'Tether Ask: read-only analytics over the approval queue, rule firings, rules, readings and threshold edits. Synthetic data only';

-- Check: one row per firing that is about missing readings.
SELECT * FROM SEMANTIC_VIEW(
  CARE_RULES.CORE.TETHER_ANALYTICS
  DIMENSIONS firings.firing_patient_id, firings.firing_rule_id, firings.overdue_measure, firings.days_overdue
  METRICS firings.firing_count
)
ORDER BY firing_patient_id;
