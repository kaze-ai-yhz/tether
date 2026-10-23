-- =====================================================================
-- Tether roles (base). Runs after Faiz's sql/care_rules_snowflake.sql.
-- The two roles exist early so role-restricted access tokens can be minted for the app.
-- This file grants read access only. Procedure USAGE is granted separately by
-- APPLY_GRANTS(): the care agent can draft but never approve or send.
-- Idempotent: CREATE ROLE IF NOT EXISTS; repeating a GRANT is a no-op.
-- =====================================================================
USE SCHEMA CARE_RULES.CORE;

CREATE ROLE IF NOT EXISTS CARE_AGENT_ROLE COMMENT = 'Tether care agent: reads and drafts; cannot approve or send';
CREATE ROLE IF NOT EXISTS CLINICIAN_ROLE  COMMENT = 'Tether clinician: approves, edits or rejects drafts';

-- The demo user holds both roles; each app token is restricted to one of them.
-- The user is named USER, a keyword, so the identifier is quoted.
GRANT ROLE CARE_AGENT_ROLE TO USER "USER";
GRANT ROLE CLINICIAN_ROLE  TO USER "USER";

GRANT USAGE ON WAREHOUSE DEFAULT_WH  TO ROLE CARE_AGENT_ROLE;
GRANT USAGE ON WAREHOUSE DEFAULT_WH  TO ROLE CLINICIAN_ROLE;
GRANT USAGE ON DATABASE CARE_RULES   TO ROLE CARE_AGENT_ROLE;
GRANT USAGE ON DATABASE CARE_RULES   TO ROLE CLINICIAN_ROLE;
GRANT USAGE ON SCHEMA CARE_RULES.CORE TO ROLE CARE_AGENT_ROLE;
GRANT USAGE ON SCHEMA CARE_RULES.CORE TO ROLE CLINICIAN_ROLE;

-- Read access to every table and view now, and to every table or view created later in the schema
-- (Faiz's file recreates its tables and views on each run). Neither role gets INSERT, UPDATE or
-- DELETE: writes go only through procedures.
GRANT SELECT ON ALL TABLES    IN SCHEMA CARE_RULES.CORE TO ROLE CARE_AGENT_ROLE;
GRANT SELECT ON ALL VIEWS     IN SCHEMA CARE_RULES.CORE TO ROLE CARE_AGENT_ROLE;
GRANT SELECT ON FUTURE TABLES IN SCHEMA CARE_RULES.CORE TO ROLE CARE_AGENT_ROLE;
GRANT SELECT ON FUTURE VIEWS  IN SCHEMA CARE_RULES.CORE TO ROLE CARE_AGENT_ROLE;

GRANT SELECT ON ALL TABLES    IN SCHEMA CARE_RULES.CORE TO ROLE CLINICIAN_ROLE;
GRANT SELECT ON ALL VIEWS     IN SCHEMA CARE_RULES.CORE TO ROLE CLINICIAN_ROLE;
GRANT SELECT ON FUTURE TABLES IN SCHEMA CARE_RULES.CORE TO ROLE CLINICIAN_ROLE;
GRANT SELECT ON FUTURE VIEWS  IN SCHEMA CARE_RULES.CORE TO ROLE CLINICIAN_ROLE;
