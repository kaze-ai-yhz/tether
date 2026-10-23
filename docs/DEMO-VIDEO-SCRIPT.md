# Tether: 1-Minute Demo Video Script

Screen recording of Snowsight with a voiceover. About 140 words, which fits 60 seconds at a natural pace.

| Time | On screen | Voiceover |
| --- | --- | --- |
| 0:00 to 0:08 | Title card: "Tether: keeping chronic patients connected between visits." Built today with Snowflake and Claude. | "Half of chronic disease medications aren't taken as prescribed. Tether is the follow-up team practices can't hire, and a physician approves every action." |
| 0:08 to 0:22 | Snowsight: run `SELECT * FROM V_RULE_FIRINGS;` and scroll the results | "Snowflake holds the patients, home readings and guideline rules. Here, a blood pressure of 186 over 122 goes straight to the doctor. A COPD patient at 88 percent is sent for an oxygen evaluation, not another inhaler change. A patient silent for a month is flagged before they're lost." |
| 0:22 to 0:38 | Open SYN-015's note, delete the "BP goal" line, rerun the query | "Doctors steer Tether from their notes. This 82-year-old fell, so her doctor set a gentler blood pressure goal. Remove that line, and Tether recommends a dose increase." |
| 0:38 to 0:46 | Show SYN-005's blocked line in `V_PATIENT_OVERRIDES` | "But no note can switch off a safety alert. This one is blocked and sent back to the doctor." |
| 0:46 to 0:56 | `CALL GENERATE_DRAFTS();` then open one draft, then run `REVIEW_ACTION` | "Claude drafts each message in the patient's language and cites the guideline. Nothing goes out until the clinician approves." |
| 0:56 to 1:00 | End card: Tether, plus the GitHub link | "Tether: a phone call instead of a hospital bed." |

## Recording tips

- **Prepare:** run `sql/care_rules_snowflake.sql` and `CALL GENERATE_DRAFTS();` once beforehand so drafts already exist. Keep the three queries open in separate worksheet tabs.
- **Tools:** QuickTime (File, New Screen Recording) or Loom. Zoom the browser to about 125% so text is readable.
- **Share:** upload as Unlisted on YouTube, check the link plays in a private window, then paste it into the submission form.

## SQL for each shot

```sql
-- Shot 2
SELECT patient_id, condition, rule_id, recipient, evidence FROM V_RULE_FIRINGS ORDER BY priority, patient_id;

-- Shot 3: remove SYN-015's individualized BP goal, then rerun shot 2
UPDATE CLINICAL_NOTES
   SET note_text = REPLACE(note_text, '- BP goal: < 140/90 (age 82, orthostatic dizziness, fall in July 2026)', '')
 WHERE note_id = 'N-045';
SELECT patient_id, rule_id, evidence FROM V_RULE_FIRINGS WHERE patient_id = 'SYN-015';

-- Shot 4
SELECT patient_id, note_id, line, status FROM V_PATIENT_OVERRIDES WHERE status <> 'APPLIED';

-- Shot 5
CALL GENERATE_DRAFTS();
SELECT action_id, patient_id, rule_id, draft_text FROM ACTION_QUEUE ORDER BY action_id;
CALL REVIEW_ACTION(1, 'APPROVED', 'Reviewed for demo', NULL);
SELECT * FROM AUDIT_LOG ORDER BY logged_at DESC;
```

To restore SYN-015's goal after recording, rerun the CLINICAL_NOTES insert from the SQL file.
