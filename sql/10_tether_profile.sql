-- =====================================================================
-- Tether patient profiles for Faiz's synthetic patients SYN-001..015.
-- Display names are fictional (tree surnames A to O), live only in this table, and are never
-- sent to a model; MODEL_CALLS is checked for them. Runs after Faiz's sql/care_rules_snowflake.sql.
-- Idempotent: the table is created once; only these 15 seed rows are replaced.
-- =====================================================================
USE SCHEMA CARE_RULES.CORE;

CREATE TABLE IF NOT EXISTS PATIENT_PROFILE (
    patient_id       VARCHAR,
    display_name     VARCHAR,      -- fictional; shown in the app only
    doctor_id        VARCHAR,
    next_visit_on    DATE,
    ai_call_consent  BOOLEAN,      -- consent on file for AI check-in calls
    phone_ok         BOOLEAN
);

DELETE FROM PATIENT_PROFILE
WHERE patient_id IN ('SYN-001','SYN-002','SYN-003','SYN-004','SYN-005','SYN-006','SYN-007','SYN-008',
                     'SYN-009','SYN-010','SYN-011','SYN-012','SYN-013','SYN-014','SYN-015');

-- Next visits are weekdays 14 to 90 days after the demo date 2026-10-23.
INSERT INTO PATIENT_PROFILE (patient_id, display_name, doctor_id, next_visit_on, ai_call_consent, phone_ok)
SELECT s.patient_id, s.display_name, 'DR-SYNTHETIC', DATEADD('day', s.visit_in_days, '2026-10-23'::DATE),
       s.ai_call_consent, TRUE
FROM (VALUES
  ('SYN-001', 'Adam Alder',    31, TRUE),
  ('SYN-002', 'Bea Birch',     84, TRUE),
  ('SYN-003', 'Cal Cedar',     14, TRUE),
  ('SYN-004', 'Dina Dogwood',  21, TRUE),
  ('SYN-005', 'Ed Elm',        17, TRUE),
  ('SYN-006', 'Faye Fir',      28, TRUE),
  ('SYN-007', 'Gil Ginkgo',    32, TRUE),
  ('SYN-008', 'Hal Hazel',     25, TRUE),
  ('SYN-009', 'Iris Ironwood', 18, TRUE),
  ('SYN-010', 'Jon Juniper',   42, TRUE),
  ('SYN-011', 'Kay Katsura',   60, FALSE),   -- note N-033: AI calls not allowed (prefers a person)
  ('SYN-012', 'Lou Larch',     20, TRUE),
  ('SYN-013', 'Mo Maple',      45, TRUE),
  ('SYN-014', 'Nell Nutmeg',   56, TRUE),
  ('SYN-015', 'Opal Oak',      89, TRUE)
) AS s(patient_id, display_name, visit_in_days, ai_call_consent);
