# Tether: 1-Minute Demo Video Script

Screen recording with a voiceover. About 130 words, which fits 60 seconds at a natural pace.

| Time | On screen | Voiceover |
| --- | --- | --- |
| 0:00 to 0:10 | Title card: "Tether: keeping chronic patients connected between visits" | "Half of chronic disease medications aren't taken as prescribed. Office staff can't call every patient to check, so problems surface in the ER." |
| 0:10 to 0:25 | Patient list with each patient's next step (`V_RULE_FIRINGS` or the app) | "Tether watches home blood pressure, oxygen and glucose readings, plus refills, against AHA, GOLD and ADA guidelines, and flags who needs attention today." |
| 0:25 to 0:40 | Follow-up rows: reminder, AI check-in call, flag to clinician | "When a patient misses readings or doses, Tether follows up for the staff: a text reminder first, then an AI check-in call. Only the patients who still need a person reach the care team." |
| 0:40 to 0:53 | One Claude draft, then the approve click | "Claude drafts each message in the patient's language. The clinician reviews and approves with one click, instead of making the call." |
| 0:53 to 1:00 | End card: Tether, plus the GitHub link | "Fewer phone calls for staff, better compliance for patients. That's Tether." |

The 50% figure is sourced in `docs/PITCH.md`. The script describes how Tether reduces calls but does not claim a specific number of hours saved, since that has not been measured.

## Recording tips

- **Prepare:** run `sql/care_rules_snowflake.sql` and `CALL GENERATE_DRAFTS();` once beforehand so drafts already exist.
- **Record:** on a Mac, press Cmd + Shift + 5, choose Record Selected Portion, and set the microphone under Options. Zoom the browser to about 125% so text is readable.
- **Share:** upload as Unlisted on YouTube, check the link plays in a private window, then paste it into the submission form.

## SQL for each shot (if recording in Snowsight)

```sql
-- Patient list and next steps
SELECT patient_id, condition, rule_id, recipient, evidence FROM V_RULE_FIRINGS ORDER BY priority, patient_id;

-- Follow-up ladder rows
SELECT patient_id, rule_id, step, recipient, evidence FROM V_RULE_FIRINGS WHERE rule_id LIKE 'ENG-%' ORDER BY patient_id;

-- Claude draft and approval
CALL GENERATE_DRAFTS();
SELECT action_id, patient_id, rule_id, draft_text FROM ACTION_QUEUE ORDER BY action_id;
CALL REVIEW_ACTION(1, 'APPROVED', 'Reviewed for demo', NULL);
```
