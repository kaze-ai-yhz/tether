-- =====================================================================
-- Tether tables. Runs after Faiz's sql/care_rules_snowflake.sql and never redefines his objects.
-- Idempotent: CREATE TABLE IF NOT EXISTS; seeds replace only their own rows.
-- Tether ids are UUID strings (no AUTOINCREMENT): Faiz's file restarts ACTION_QUEUE ids on every
-- run, so rows are joined on keys, never on id order.
-- =====================================================================
USE SCHEMA CARE_RULES.CORE;

-- One plan per patient x condition, read from the latest signed AI Plan block.
CREATE TABLE IF NOT EXISTS CARE_PLANS (
    plan_id        VARCHAR DEFAULT UUID_STRING(),
    patient_id     VARCHAR,
    condition      VARCHAR,          -- HTN | COPD | T2DM
    note_id        VARCHAR,          -- CLINICAL_NOTES.note_id of the AI Plan block that was read
    mode           VARCHAR,          -- Standard (no applied override) | Custom (has applied overrides)
    status         VARCHAR,          -- ACTIVE | NEEDS_REVIEW (an AI Plan line was not applied)
    reading        VARIANT,          -- Claude's plain-language reading {summary, lines[{line, meaning, concern}]}
    reading_model  VARCHAR,
    validation     VARIANT,
    created_at     TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    closed_by      VARCHAR,
    closed_at      TIMESTAMP_NTZ
);

-- Table 1: what the care team collects or watches; each item traces to a rule or an AI Plan setting.
CREATE TABLE IF NOT EXISTS TODOS (
    todo_id     VARCHAR DEFAULT UUID_STRING(),
    plan_id     VARCHAR,
    patient_id  VARCHAR,
    seq         INT,
    todo_text   VARCHAR,
    rule_id     VARCHAR,             -- RULES.rule_id
    setting     VARCHAR,             -- V_ACTIVE_OVERRIDES.setting for AI Plan items
    layer       VARCHAR,             -- P0 (RULES default) | P2 (AI Plan)
    due_on      DATE,
    done        BOOLEAN DEFAULT FALSE,
    kind        VARCHAR,             -- COLLECT | WATCH | REVIEW (never a send)
    source      VARCHAR              -- how the item was composed, e.g. 'composed from rules'
);

-- Threshold edits made through UPDATE_RULE.
CREATE TABLE IF NOT EXISTS RULE_EDITS (
    edit_id    VARCHAR DEFAULT UUID_STRING(),
    rule_id    VARCHAR,
    field      VARCHAR,              -- threshold1 | threshold2 | window_days | min_readings
    old_value  VARCHAR,
    new_value  VARCHAR,
    reason     VARCHAR,
    edited_by  VARCHAR,
    edited_at  TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    impact     VARIANT               -- V_RULE_FIRINGS rows that changed
);

-- Simulated sends. A row exists only for an APPROVED or EDITED action, except the internal
-- alert of a red flag to the clinician.
CREATE TABLE IF NOT EXISTS OUTBOX (
    msg_id      VARCHAR DEFAULT UUID_STRING(),
    action_id   NUMBER,              -- ACTION_QUEUE.action_id
    channel     VARCHAR,             -- SMS | AI_CALL | PRESCRIBER | PHARMACY | CLINICIAN | INTERNAL_ALERT
    recipient   VARCHAR,
    patient_id  VARCHAR,
    payload     VARCHAR,
    provider    VARCHAR DEFAULT 'simulated',
    sent_at     TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    sent_sim    DATE                 -- simulated clock (AS_OF) at send time
);

-- Simulated AI check-in calls.
CREATE TABLE IF NOT EXISTS CALL_TRANSCRIPTS (
    call_id     VARCHAR DEFAULT UUID_STRING(),
    action_id   NUMBER,
    patient_id  VARCHAR,
    attempt     INT,
    outcome     VARCHAR,             -- ANSWERED | NO_ANSWER | HANDOFF | ID_FAILED
    transcript  VARCHAR,
    answers     VARIANT,             -- built from SQL values, never parsed from model text
    rule_id     VARCHAR,
    at_sim      DATE,
    scenario    VARCHAR,             -- ANSWERED | NO_ANSWER | CHEST_PAIN
    model       VARCHAR,
    created_at  TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

-- Every model input and output. Append-only: never truncated, restored or deleted.
CREATE TABLE IF NOT EXISTS MODEL_CALLS (
    call_id     VARCHAR DEFAULT UUID_STRING(),
    proc        VARCHAR,
    model       VARCHAR,
    input_text  VARCHAR,
    output      VARCHAR,
    at          TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    ref_type    VARCHAR,
    ref_id      VARCHAR,
    patient_id  VARCHAR,             -- SYN id only
    ok          BOOLEAN              -- FALSE when the model returned NULL (failed call)
);

-- Per-draft metadata for ACTION_QUEUE rows (Faiz's table is not altered).
CREATE TABLE IF NOT EXISTS ACTION_META (
    action_id     NUMBER,            -- ACTION_QUEUE.action_id
    run_id        VARCHAR,
    kind          VARCHAR,           -- DRAFT | RED_FLAG | PLAN_REVIEW | CALL_RETRY | CALL_ESCALATION | CALL_HANDOFF
    sim_date      DATE,              -- simulated clock (AS_OF) when drafted
    layer         VARCHAR,           -- P0 (RULES default) | P2 (AI Plan)
    model         VARCHAR,
    draft_source  VARCHAR,           -- CLAUDE | TEMPLATE | RULE | FAIZ
    safety_ok     BOOLEAN,           -- drug and dose post-check passed
    safety_notes  VARCHAR,
    call_id       VARCHAR,           -- MODEL_CALLS.call_id
    created_at    TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

-- Drafting stage: each prompt and its model output are stored once per run, then copied to
-- MODEL_CALLS and ACTION_QUEUE (one model call per draft).
CREATE TABLE IF NOT EXISTS DRAFT_STAGE (
    run_id        VARCHAR,
    patient_id    VARCHAR,
    condition     VARCHAR,
    rule_id       VARCHAR,
    kind          VARCHAR,           -- as ACTION_META.kind
    prompt        VARCHAR,
    output        VARCHAR,
    ok            BOOLEAN,           -- FALSE when the model returned NULL
    safety_ok     BOOLEAN,
    safety_notes  VARCHAR,
    source        VARCHAR,           -- CLAUDE | TEMPLATE | RULE
    model         VARCHAR,
    created_at    TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

-- AUDIT_LOG rows copied before anything recreates AUDIT_LOG.
-- Append-only: never cloned, replaced, truncated or deleted.
CREATE TABLE IF NOT EXISTS AUDIT_ARCHIVE (
    reset_id     VARCHAR,
    archived_at  TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    logged_at    TIMESTAMP_NTZ,
    actor        VARCHAR,
    event        VARCHAR,
    action_id    NUMBER,
    detail       VARCHAR
);

-- Approver labels for the fallback check, used only if role grants misbehave
-- (the app then labels it "role check simulated").
CREATE TABLE IF NOT EXISTS APPROVERS (
    user_name   VARCHAR,
    role_label  VARCHAR
);

-- Recorded answers for the Ask drawer (shown as "Recorded answer").
CREATE TABLE IF NOT EXISTS ASK_CACHE (
    question     VARCHAR,
    answer       VARIANT,
    recorded_at  TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

-- Settings that procedures read into variables (never session variables).
CREATE TABLE IF NOT EXISTS TETHER_SETTINGS (
    key    VARCHAR,
    value  VARCHAR
);

-- Drug and dose words checked against every draft, edited text and call transcript.
-- Separate from Faiz's SAFETY_LOCKED_TERMS, which blocks AI Plan lines that weaken a safety rule.
CREATE TABLE IF NOT EXISTS SAFETY_TERMS (
    term    VARCHAR,
    kind    VARCHAR,                 -- DRUG_CLASS | DRUG_NAME | DOSE_UNIT
    source  VARCHAR
);

-- ---------------------------------------------------------------------
-- Seeds
-- ---------------------------------------------------------------------
DELETE FROM APPROVERS WHERE user_name IN ('CLINICIAN', 'CARE_AGENT');
INSERT INTO APPROVERS (user_name, role_label) VALUES
 ('CLINICIAN',  'CLINICIAN'),
 ('CARE_AGENT', 'CARE_AGENT');

-- Model ids answered AI_COMPLETE in this account. Structured output (response_format) works only on
-- claude-sonnet-4-5, so the AI Plan reader uses it.
DELETE FROM TETHER_SETTINGS
WHERE key IN ('MODEL_READER', 'MODEL_COMPOSER', 'MODEL_DRAFTER', 'MODEL_CALLER', 'MODEL_AGENT',
              'ROLES_MODE', 'DEMO_AS_OF', 'APPROVER_LABEL');
INSERT INTO TETHER_SETTINGS (key, value) VALUES
 ('MODEL_READER',   'claude-sonnet-4-5'),
 ('MODEL_COMPOSER', 'claude-opus-5-5'),
 ('MODEL_DRAFTER',  'claude-sonnet-5-5'),
 ('MODEL_CALLER',   'claude-sonnet-5-5'),
 ('MODEL_AGENT',    'claude-sonnet-4-5'),
 ('ROLES_MODE',     'REAL'),
 ('DEMO_AS_OF',     '2026-10-23'),
 ('APPROVER_LABEL', 'Dr. Example');

-- Does AI_COMPLETE accept model_parameters on each id? One call per id, logged in MODEL_CALLS like
-- every model input; later runs reuse the logged result and make no call. NULL output = not accepted.
INSERT INTO MODEL_CALLS (proc, model, input_text, output, ref_type, ref_id, ok)
SELECT 'MODEL_PARAMS_PROBE', 'claude-sonnet-5-5', 'Reply with: ready', p.output,
       'TETHER_SETTINGS', 'MODEL_PARAMS_OK_CLAUDE_SONNET_5_5', p.output IS NOT NULL
FROM (SELECT AI_COMPLETE(model => 'claude-sonnet-5-5', prompt => 'Reply with: ready',
                         model_parameters => {'temperature': 0})::VARCHAR AS output
      FROM (SELECT 1) one
      WHERE NOT EXISTS (SELECT 1 FROM MODEL_CALLS c
                        WHERE c.proc = 'MODEL_PARAMS_PROBE' AND c.model = 'claude-sonnet-5-5')) p;

INSERT INTO MODEL_CALLS (proc, model, input_text, output, ref_type, ref_id, ok)
SELECT 'MODEL_PARAMS_PROBE', 'claude-opus-5-5', 'Reply with: ready', p.output,
       'TETHER_SETTINGS', 'MODEL_PARAMS_OK_CLAUDE_OPUS_5_5', p.output IS NOT NULL
FROM (SELECT AI_COMPLETE(model => 'claude-opus-5-5', prompt => 'Reply with: ready',
                         model_parameters => {'temperature': 0})::VARCHAR AS output
      FROM (SELECT 1) one
      WHERE NOT EXISTS (SELECT 1 FROM MODEL_CALLS c
                        WHERE c.proc = 'MODEL_PARAMS_PROBE' AND c.model = 'claude-opus-5-5')) p;

INSERT INTO MODEL_CALLS (proc, model, input_text, output, ref_type, ref_id, ok)
SELECT 'MODEL_PARAMS_PROBE', 'claude-sonnet-4-5', 'Reply with: ready', p.output,
       'TETHER_SETTINGS', 'MODEL_PARAMS_OK_CLAUDE_SONNET_4_5', p.output IS NOT NULL
FROM (SELECT AI_COMPLETE(model => 'claude-sonnet-4-5', prompt => 'Reply with: ready',
                         model_parameters => {'temperature': 0})::VARCHAR AS output
      FROM (SELECT 1) one
      WHERE NOT EXISTS (SELECT 1 FROM MODEL_CALLS c
                        WHERE c.proc = 'MODEL_PARAMS_PROBE' AND c.model = 'claude-sonnet-4-5')) p;

-- MODEL_PARAMS_OK_<ID> = TRUE when the logged probe for that id returned text.
DELETE FROM TETHER_SETTINGS WHERE STARTSWITH(key, 'MODEL_PARAMS_OK_');
INSERT INTO TETHER_SETTINGS (key, value)
SELECT 'MODEL_PARAMS_OK_' || UPPER(REPLACE(model, '-', '_')), IFF(BOOLOR_AGG(ok), 'TRUE', 'FALSE')
FROM MODEL_CALLS
WHERE proc = 'MODEL_PARAMS_PROBE'
GROUP BY model;

-- Drug classes come from Faiz's MEDICATIONS. 'Fixed-dose combination' is left out: it names a
-- guideline step, not a drug.
DELETE FROM SAFETY_TERMS WHERE source IN ('MEDICATIONS.drug_class', 'Tether starter list, Faiz to extend');
INSERT INTO SAFETY_TERMS (term, kind, source)
SELECT DISTINCT drug_class, 'DRUG_CLASS', 'MEDICATIONS.drug_class'
FROM MEDICATIONS
WHERE drug_class IS NOT NULL AND drug_class <> 'Fixed-dose combination';

-- Generic names for the three pathways (brand names not included yet).
INSERT INTO SAFETY_TERMS (term, kind, source)
SELECT t.term, 'DRUG_NAME', 'Tether starter list, Faiz to extend'
FROM (VALUES
  -- hypertension
  ('lisinopril'), ('enalapril'), ('ramipril'), ('losartan'), ('valsartan'), ('olmesartan'),
  ('amlodipine'), ('nifedipine'), ('diltiazem'), ('hydrochlorothiazide'), ('chlorthalidone'),
  ('metoprolol'), ('carvedilol'), ('spironolactone'),
  -- COPD
  ('tiotropium'), ('umeclidinium'), ('glycopyrronium'), ('salmeterol'), ('formoterol'), ('vilanterol'),
  ('olodaterol'), ('albuterol'), ('salbutamol'), ('ipratropium'), ('budesonide'), ('fluticasone'),
  ('roflumilast'), ('prednisone'),
  -- type 2 diabetes
  ('glipizide'), ('glimepiride'), ('sitagliptin'), ('linagliptin'), ('empagliflozin'), ('dapagliflozin'),
  ('canagliflozin'), ('semaglutide'), ('liraglutide'), ('dulaglutide'), ('tirzepatide'), ('pioglitazone'),
  ('insulin glargine')
) AS t(term);

-- Dose units. Reading units (mg/dL, mmHg, %) are not doses; the draft check strips them first.
INSERT INTO SAFETY_TERMS (term, kind, source)
SELECT t.term, 'DOSE_UNIT', 'Tether starter list, Faiz to extend'
FROM (VALUES ('mg'), ('mcg'), ('units'), ('puffs'), ('tablets'), ('ml')) AS t(term);
