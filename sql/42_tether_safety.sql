-- =====================================================================
-- Tether drug and dose post-check. Runs after sql/15_tether_tables.sql (SAFETY_TERMS).
-- SAFETY_CHECK(txt) returns {ok, hits[]}; ok is FALSE when the text names a drug, a drug class
-- or a dose. It runs on every draft, every clinician edit and every call transcript.
--   1. Reading values are removed first: a number followed by mg/dL, mmHg or % is a reading,
--      not a dose.
--   2. A number followed by a dose unit is flagged (mg, mcg, ml, unit(s), IU, puff(s), tablet(s),
--      plus any SAFETY_TERMS row of kind DOSE_UNIT).
--   3. Any SAFETY_TERMS drug name or drug class is flagged as a whole-word match, ignoring case
--      and punctuation.
-- Guideline steps pass ("missed doses", "dose increase", "Walk 20 minutes daily").
-- The SAFETY_TERMS lookups are uncorrelated subqueries, so the function also works on a column
-- across many rows (for example an UPDATE over DRAFT_STAGE).
-- Idempotent: CREATE OR REPLACE ... COPY GRANTS.
-- =====================================================================
USE SCHEMA CARE_RULES.CORE;

CREATE OR REPLACE FUNCTION SAFETY_CHECK(txt VARCHAR)
COPY GRANTS
RETURNS VARIANT
LANGUAGE SQL
COMMENT = 'Tether drug and dose post-check: {ok, hits[]}'
AS
$$
  -- The body is one expression; the one-element TRANSFORM names the hits array once.
  GET(TRANSFORM(
    ARRAY_CONSTRUCT(ARRAY_CAT(
      -- dose: number + unit, after reading values (mg/dL, mmHg, %) are removed
      COALESCE(REGEXP_SUBSTR_ALL(
        REGEXP_REPLACE(COALESCE(txt, ''), '[0-9][0-9.,]* ?(mg/dl|mmhg|%)', ' ', 1, 0, 'i') || ' ',
        '([0-9][0-9.,]* ?(' || (
          SELECT LISTAGG(u.unit, '|')
          FROM (
            SELECT column1 AS unit
            FROM VALUES ('mg'), ('mcg'), ('ml'), ('units?'), ('iu'), ('puffs?'), ('tablets?')
            UNION
            SELECT LOWER(TRIM(term))
            FROM SAFETY_TERMS
            WHERE kind = 'DOSE_UNIT' AND REGEXP_LIKE(LOWER(TRIM(term)), '[a-z]+')
          ) u
        ) || '))[^a-z]',
        1, 1, 'ie', 1), ARRAY_CONSTRUCT()),
      -- drug name or class: whole words on lower-case text with punctuation as spaces
      -- (separators are doubled so adjacent terms each keep a boundary)
      COALESCE(TRANSFORM(
        REGEXP_SUBSTR_ALL(
          '  ' || REGEXP_REPLACE(LOWER(COALESCE(txt, '')), '[^a-z0-9]+', '  ') || '  ',
          ' (' || (
            SELECT LISTAGG(t.term, '|') WITHIN GROUP (ORDER BY LENGTH(t.term) DESC, t.term)
            FROM (
              SELECT DISTINCT TRIM(REGEXP_REPLACE(LOWER(term), '[^a-z0-9]+', '  ')) AS term
              FROM SAFETY_TERMS
              WHERE kind IN ('DRUG_NAME', 'DRUG_CLASS')
                AND REGEXP_LIKE(LOWER(term), '.*[a-z0-9].*')
            ) t
          ) || ') ',
          1, 1, 'e', 1),
        h VARCHAR -> REGEXP_REPLACE(h, ' +', ' ')), ARRAY_CONSTRUCT())
    )),
    hits -> OBJECT_CONSTRUCT('ok', ARRAY_SIZE(hits) = 0, 'hits', hits)
  ), 0)
$$;

-- Self-tests (run by hand after changes; RUN_CHECKS repeats the reading cases):
--   SELECT t.txt, SAFETY_CHECK(t.txt) AS result
--   FROM VALUES ('51 mg/dL'), ('186/122 mmHg'), ('Walk 20 minutes daily'), ('missed doses'),
--               ('dose increase'), ('take 10 mg'), ('metformin') AS t(txt);
--   Expected: the first five ok = TRUE; 'take 10 mg' -> hits ["10 mg"]; 'metformin' -> hits ["metformin"].
