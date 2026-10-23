# Safety and compliance · Tether v2

Faiz's "Purpose and guardrails", "Safety checks", "AI check-in calls" and "Clinician approval
gate" in `docs/RUNBOOK.md` are the hard rules. This page lists what the Tether layer adds or must
not break.

## Hard rules
1. **Nothing goes out without a clinician.** Every outbound action is an `ACTION_QUEUE` draft;
   `SEND_APPROVED` reads only `V_READY_TO_SEND`. Red flags are internal clinician alerts.
2. **No diagnosis, no drug or dose choice.** Drafts name the guideline step only. Custom AI Plan
   lines asking for a drug or dose change become a prescriber review or Needs clinician.
3. **COPD low SpO2 → oxygen evaluation**, never repeated inhaler escalation.
4. **Safety checks run first** (red flags, enough data, adherence before escalation, recent change,
   duplicate guard). P1/P2 rules cannot bypass, loosen or remove them.
5. **Missing data is never "at goal"**; it drives the ENG ladder.
6. **AI check-in calls** disclose they are automated, confirm two identifiers, collect only, hand
   off on symptoms, red-flag values, questions, requests for a person or failed identity; need
   consent on file. Simulated today: no real calls.
7. **Synthetic data only.** Model inputs carry SYN ids, the AI Plan text and evidence strings;
   synthetic names stay in `PATIENT_PROFILE` and are checked absent from `MODEL_CALLS`.
8. **Guideline text:** cite and link; Faiz-written summaries only; no large pasted passages.
9. **Audit everything** in `AUDIT_LOG`; never update or delete it.
10. **Secrets:** PAT only in `app/web/.env.local` (git-ignored), server-side. Secret scan before push.

## Honesty
- Labels: simulated clock, simulated adapters and calls, thresholds "pending clinician confirmation
  against full text" until Faiz confirms.
- Numbers on screen and in the video come from queries.
- Pitch: care-team workflow automation, not medical advice.
- Consistent with Faiz's README: all code and data in the repo were created during the event; the
  planning docs in `docs/tether/` were drafted earlier today as notes.
