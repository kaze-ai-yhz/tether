-- =====================================================================
-- Tether procedure grants. Runs after every file that creates a Tether procedure, and again after
-- every reset or rebuild (procedure USAGE is never a future grant).
-- APPLY_GRANTS() gives
--   both roles       SELECT on every table and view in CARE_RULES.CORE (future tables and views
--                    are covered by sql/12_tether_roles_base.sql);
--   CARE_AGENT_ROLE  USAGE on the procedures that read, draft, advance the simulated clock,
--                    simulate calls and log a refused approval;
--   CLINICIAN_ROLE   the same, plus the approval gate (TETHER_REVIEW, REVIEW_ACTION,
--                    SEND_APPROVED) and the threshold edit (UPDATE_RULE).
-- The approval-gate procedures are also revoked from CARE_AGENT_ROLE, so the agent can draft but
-- never approve or send even if one was granted by hand. Every overload found in
-- INFORMATION_SCHEMA is granted; names that do not exist yet are skipped and listed in the result.
-- Idempotent: CREATE OR REPLACE ... COPY GRANTS; repeating a GRANT or REVOKE is a no-op.
-- =====================================================================
USE SCHEMA CARE_RULES.CORE;

CREATE OR REPLACE PROCEDURE APPLY_GRANTS()
COPY GRANTS
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS OWNER
AS
$$
DECLARE
  granted_agent ARRAY DEFAULT ARRAY_CONSTRUCT();
  granted_clinician ARRAY DEFAULT ARRAY_CONSTRUCT();
  revoked_agent ARRAY DEFAULT ARRAY_CONSTRUCT();
  missing ARRAY DEFAULT ARRAY_CONSTRUCT();
  sig VARCHAR;
  detail VARCHAR;
BEGIN
  EXECUTE IMMEDIATE 'GRANT SELECT ON ALL TABLES IN SCHEMA CARE_RULES.CORE TO ROLE CARE_AGENT_ROLE';
  EXECUTE IMMEDIATE 'GRANT SELECT ON ALL VIEWS IN SCHEMA CARE_RULES.CORE TO ROLE CARE_AGENT_ROLE';
  EXECUTE IMMEDIATE 'GRANT SELECT ON ALL TABLES IN SCHEMA CARE_RULES.CORE TO ROLE CLINICIAN_ROLE';
  EXECUTE IMMEDIATE 'GRANT SELECT ON ALL VIEWS IN SCHEMA CARE_RULES.CORE TO ROLE CLINICIAN_ROLE';

  -- for_agent TRUE: both roles; FALSE: clinician only (and revoked from the agent)
  LET rs RESULTSET := (
    WITH wanted (name, for_agent) AS (
      SELECT * FROM VALUES
        ('TICK', TRUE), ('DRAFT_ACTIONS', TRUE), ('ADVANCE_CLOCK', TRUE), ('READ_AI_PLAN', TRUE),
        ('PREPARE_PLANS', TRUE), ('SIMULATE_CHECKIN_CALL', TRUE), ('LOG_REVIEW_DENIED', TRUE),
        ('PREVIEW_RULE_EDIT', TRUE), ('DEMO_RESET', TRUE),
        ('TETHER_REVIEW', FALSE), ('REVIEW_ACTION', FALSE), ('SEND_APPROVED', FALSE), ('UPDATE_RULE', FALSE)
    )
    SELECT w.name, w.for_agent,
           IFF(p.procedure_name IS NULL, NULL,
               'CARE_RULES.CORE."' || p.procedure_name || '"'
               || REGEXP_REPLACE(p.argument_signature, '([(,] *)[^ ,()]+ ', '\\1')) AS sig
    FROM wanted w
    LEFT JOIN CARE_RULES.INFORMATION_SCHEMA.PROCEDURES p
      ON p.procedure_schema = 'CORE' AND p.procedure_name = w.name
    ORDER BY w.name, sig
  );
  LET c1 CURSOR FOR rs;
  FOR rec IN c1 DO
    IF (rec.sig IS NULL) THEN
      missing := ARRAY_APPEND(missing, rec.name);
    ELSE
      sig := rec.sig;
      IF (rec.for_agent) THEN
        EXECUTE IMMEDIATE 'GRANT USAGE ON PROCEDURE ' || sig || ' TO ROLE CARE_AGENT_ROLE';
        granted_agent := ARRAY_APPEND(granted_agent, sig);
      ELSE
        EXECUTE IMMEDIATE 'REVOKE USAGE ON PROCEDURE ' || sig || ' FROM ROLE CARE_AGENT_ROLE';
        revoked_agent := ARRAY_APPEND(revoked_agent, sig);
      END IF;
      EXECUTE IMMEDIATE 'GRANT USAGE ON PROCEDURE ' || sig || ' TO ROLE CLINICIAN_ROLE';
      granted_clinician := ARRAY_APPEND(granted_clinician, sig);
    END IF;
  END FOR;

  detail := 'SELECT on all tables and views to CARE_AGENT_ROLE and CLINICIAN_ROLE; USAGE on '
            || ARRAY_SIZE(granted_agent) || ' procedures to CARE_AGENT_ROLE and '
            || ARRAY_SIZE(granted_clinician) || ' to CLINICIAN_ROLE; approval gate revoked from CARE_AGENT_ROLE ('
            || ARRAY_SIZE(revoked_agent) || ')'
            || IFF(ARRAY_SIZE(missing) = 0, '', '; not created yet: ' || ARRAY_TO_STRING(missing, ', '));
  INSERT INTO AUDIT_LOG (actor, event, detail) SELECT CURRENT_USER(), 'GRANTS_APPLIED', :detail;
  RETURN OBJECT_CONSTRUCT('ok', TRUE, 'agent', granted_agent, 'clinician', granted_clinician,
                          'revoked_from_agent', revoked_agent, 'missing', missing, 'message', detail);
END;
$$;

CALL APPLY_GRANTS();
