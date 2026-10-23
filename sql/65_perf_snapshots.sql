-- 65_perf_snapshots.sql: plain-table snapshots of the two app views whose nested definitions take
-- 30-70 s to compile on every query (V_PATIENT_LIST, V_PATIENT_DETAIL). Execution is about 2-3 s;
-- the time goes to compiling the stacked views. A plain table compiles in a fraction of a second.
--
-- The app reads PATIENT_LIST_SNAP and PATIENT_DETAIL_SNAP and falls back to the views if a snapshot is
-- missing. After every write procedure succeeds, the app calls REFRESH_SNAPSHOTS in the background, so the
-- patient screens lag a write by about the time one refresh takes (roughly a minute) instead of making
-- every page load wait for a compile.
--
-- Neither view depends on the caller's role or the current date (both read AS_OF), so a snapshot built
-- by the owner returns the same rows the view would.
--
-- Run: snow sql -c hackathon -f sql/65_perf_snapshots.sql   (idempotent; the first run takes 1-2 minutes)

USE ROLE ATTENDEE_ROLE;
USE WAREHOUSE DEFAULT_WH;
USE SCHEMA CARE_RULES.CORE;

-- One row per refresh, so the lag of each snapshot is visible.
CREATE TABLE IF NOT EXISTS SNAPSHOT_LOG (
  name         VARCHAR,
  refreshed_at TIMESTAMP_LTZ,
  seconds      NUMBER(10, 1),
  ok           BOOLEAN,
  message      VARCHAR
);

-- WHICH: 'ALL', 'PATIENT_LIST' or 'PATIENT_DETAIL'. The app refreshes the two in parallel.
-- CREATE OR REPLACE ... COPY GRANTS follows any change in the view's columns and keeps the role grants.
CREATE OR REPLACE PROCEDURE REFRESH_SNAPSHOTS(WHICH VARCHAR)
RETURNS VARCHAR
LANGUAGE SQL
EXECUTE AS OWNER
AS
$$
DECLARE
  t0 TIMESTAMP_LTZ;
  done VARCHAR DEFAULT '';
BEGIN
  IF (UPPER(:WHICH) IN ('ALL', 'PATIENT_LIST')) THEN
    t0 := CURRENT_TIMESTAMP();
    CREATE OR REPLACE TABLE PATIENT_LIST_SNAP COPY GRANTS AS SELECT * FROM V_PATIENT_LIST;
    INSERT INTO SNAPSHOT_LOG (name, refreshed_at, seconds, ok, message)
      SELECT 'PATIENT_LIST', CURRENT_TIMESTAMP(), DATEDIFF('millisecond', :t0, CURRENT_TIMESTAMP()) / 1000, TRUE, NULL;
    done := done || 'PATIENT_LIST ';
  END IF;
  IF (UPPER(:WHICH) IN ('ALL', 'PATIENT_DETAIL')) THEN
    t0 := CURRENT_TIMESTAMP();
    CREATE OR REPLACE TABLE PATIENT_DETAIL_SNAP COPY GRANTS AS SELECT * FROM V_PATIENT_DETAIL;
    INSERT INTO SNAPSHOT_LOG (name, refreshed_at, seconds, ok, message)
      SELECT 'PATIENT_DETAIL', CURRENT_TIMESTAMP(), DATEDIFF('millisecond', :t0, CURRENT_TIMESTAMP()) / 1000, TRUE, NULL;
    done := done || 'PATIENT_DETAIL ';
  END IF;
  RETURN OBJECT_CONSTRUCT('ok', TRUE, 'message', 'refreshed ' || TRIM(done))::VARCHAR;
END;
$$;

-- First build, then grants (COPY GRANTS keeps them on later rebuilds).
CALL REFRESH_SNAPSHOTS('ALL');

GRANT SELECT ON TABLE PATIENT_LIST_SNAP   TO ROLE CLINICIAN_ROLE;
GRANT SELECT ON TABLE PATIENT_LIST_SNAP   TO ROLE CARE_AGENT_ROLE;
GRANT SELECT ON TABLE PATIENT_DETAIL_SNAP TO ROLE CLINICIAN_ROLE;
GRANT SELECT ON TABLE PATIENT_DETAIL_SNAP TO ROLE CARE_AGENT_ROLE;
GRANT SELECT ON TABLE SNAPSHOT_LOG        TO ROLE CLINICIAN_ROLE;
-- Rebuilding a derived snapshot changes no clinical data, so both app roles may trigger it.
GRANT USAGE ON PROCEDURE REFRESH_SNAPSHOTS(VARCHAR) TO ROLE CLINICIAN_ROLE;
GRANT USAGE ON PROCEDURE REFRESH_SNAPSHOTS(VARCHAR) TO ROLE CARE_AGENT_ROLE;

-- Check: both snapshots exist, row counts match the views' patients, and the last refresh times.
SELECT 'PATIENT_LIST_SNAP' AS snapshot, COUNT(*) AS row_count FROM PATIENT_LIST_SNAP
UNION ALL SELECT 'PATIENT_DETAIL_SNAP', COUNT(*) FROM PATIENT_DETAIL_SNAP;
SELECT name, refreshed_at, seconds FROM SNAPSHOT_LOG ORDER BY refreshed_at DESC LIMIT 4;
