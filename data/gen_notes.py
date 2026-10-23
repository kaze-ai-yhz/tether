"""Generate synthetic SOAP notes for the Tether demo.

All patients and notes are fictional. Output:
  data/soap_notes.csv        one row per note
  data/soap_notes_insert.sql (spliced into sql/care_rules_snowflake.sql; regenerate and replace the CLINICAL_NOTES insert)
"""
import csv, os

CLIN = "Dr. Synthetic"
HERE = os.path.dirname(os.path.abspath(__file__))

# (patient_id, date, S, O, A, P, ai_plan_lines or None)
NOTES = [
 # SYN-001: stage 1, low risk, lifestyle trial not working
 ("SYN-001","2026-06-10","48 y/o man, routine visit. Two elevated office readings this year. One week of home log averages 137/85. No chest pain, headache or vision change.","BP 138/86, HR 72, BMI 29.8. Exam unremarkable.","Stage 1 hypertension. PREVENT 10-year CVD risk 4%. No diabetes, CKD or CVD.","Lifestyle trial: DASH-style eating, sodium reduction, 150 min/week activity, limit alcohol. Home BP twice daily for the week before each review. Review at 3 months.",None),
 ("SYN-001","2026-08-12","Walking 3 times a week, cutting salt. Home log average 138/85.","BP 136/86, weight down 1.5 kg.","Stage 1 hypertension, not at goal on lifestyle.","Continue lifestyle trial. Reassess at 4 to 6 months.",None),
 ("SYN-001","2026-10-02","Continues home readings. Feels well.","BP 136/84, HR 70.","Stage 1 hypertension, still above goal after 4 months of lifestyle.","If home average remains 130/80 or higher, discuss starting medication at next review.",
  ["Contact window: mornings before 10 AM","Language: English"]),
 # SYN-002: stage 1, at goal on lifestyle
 ("SYN-002","2026-07-20","41 y/o woman. Elevated readings at work wellness screen. Home log averages 134/83.","BP 134/84, BMI 26.1.","Stage 1 hypertension. PREVENT 3%.","Lifestyle trial with home monitoring. Review at 3 months.",None),
 ("SYN-002","2026-08-30","Started cycling, reduced takeout meals.","BP 129/79.","Stage 1 hypertension, improving.","Continue lifestyle trial.",None),
 ("SYN-002","2026-10-15","Home log average 126/77 over 7 days.","BP 126/78.","Stage 1 hypertension, at goal on lifestyle.","Continue lifestyle. Home BP weekly. Review in 3 months.",None),
 # SYN-003: new stage 2
 ("SYN-003","2025-10-20","57 y/o man, annual exam. No complaints.","BP 138/88, BMI 30.2.","Elevated office BP.","Recheck BP, home monitoring advised.",None),
 ("SYN-003","2026-04-22","Did not start home monitoring. Occasional morning headaches.","BP 146/92.","Elevated BP, needs confirmation with home readings.","Home BP cuff provided. Log twice daily for a week.",None),
 ("SYN-003","2026-10-15","Home log average 152/96 over 7 days.","BP 150/96, HR 78.","Stage 2 hypertension. PREVENT 9%.","Discussed starting medication with lifestyle. Patient wants to talk with his wife first; will decide this week.",
  ["Language: Vietnamese"]),
 # SYN-004: on one agent, missed doses
 ("SYN-004","2026-08-01","62 y/o woman. Home log average 148/92.","BP 150/92, BMI 28.4.","Stage 2 hypertension.","Discussed medication and lifestyle. Return in 1 month.",None),
 ("SYN-004","2026-09-08","Ready to start medication.","BP 146/90.","Stage 2 hypertension.","Started ACE inhibitor. Home BP twice daily. Recheck 4 to 6 weeks.",None),
 ("SYN-004","2026-10-06","Phone visit. Missing doses 2 to 3 times a week; copay is a concern.","Home average 138/86.","Stage 2 hypertension, not at goal; adherence barrier is cost.","Pharmacy to check lower-cost options. Reinforce daily dosing.",None),
 # SYN-005: severe reading; safety-locked line in AI Plan
 ("SYN-005","2026-05-01","66 y/o man. Home log average 162/98.","BP 160/98.","Stage 2 hypertension.","Started fixed-dose combination. Home monitoring.",None),
 ("SYN-005","2026-08-01","Tolerating medication. Home average 156/94.","BP 154/94.","Stage 2 hypertension, not at goal.","Dose increased. Recheck in 4 weeks.",None),
 ("SYN-005","2026-10-01","Thinks his home cuff reads high compared with the office.","BP 152/92. Home cuff checked against office cuff: within 5 mmHg.","Stage 2 hypertension, not at goal. Home cuff is accurate.","Continue current regimen, reassess adherence.",
  ["Red flag BP: only alert me above 200/130 (patient's cuff reads high)","AI calls: allowed"]),
 # SYN-006: COPD, low resting SpO2
 ("SYN-006","2025-11-01","71 y/o woman, former smoker. Spirometry confirmed COPD. Two exacerbations this year.","SpO2 92% at rest. Scattered wheeze.","COPD, GOLD group E.","Started LAMA/LABA inhaler. Inhaler technique taught. Pulmonary rehab referral.",None),
 ("SYN-006","2026-06-10","More breathless on stairs.","SpO2 90% at rest.","COPD, symptomatic.","Technique reviewed, good. Home pulse oximeter, log daily.",None),
 ("SYN-006","2026-09-01","Home SpO2 88 to 89% at rest most days.","SpO2 89% at rest.","COPD with low resting SpO2.","Regimen adjusted. Continue daily SpO2 logging.",
  ["Contact window: afternoons","AI calls: allowed"]),
 # SYN-007: COPD, one moderate exacerbation
 ("SYN-007","2025-04-01","68 y/o man. Spirometry confirmed COPD.","SpO2 95%.","COPD, GOLD group B.","Started LAMA inhaler.",None),
 ("SYN-007","2026-03-10","Stable, walking daily.","SpO2 95%.","COPD, stable.","Continue current inhaler.",None),
 ("SYN-007","2026-09-28","Moderate exacerbation on 9/25, treated at urgent care with an oral steroid course. Now near baseline. Using inhaler daily.","SpO2 94%.","COPD after one moderate exacerbation.","Review maintenance therapy at follow-up.",
  ["AI calls: allowed","Adherence check-ins: monthly, by phone"]),
 # SYN-008: diabetes above goal; later note supersedes earlier AI Plan
 ("SYN-008","2026-01-12","55 y/o man with T2DM on metformin.","A1C 7.4%, BMI 31.0.","T2DM, near goal.","Continue metformin. Recheck A1C 3 to 6 months.",None),
 ("SYN-008","2026-06-20","Working night shifts.","A1C 7.6%, BP 132/80.","T2DM above goal.","Diet review. Recheck A1C 3 months.",
  ["A1C goal: < 7.0%","AI calls: allowed"]),
 ("SYN-008","2026-10-10","Missing evening doses 2 to 3 times a week due to shift work. No hypoglycemia symptoms. Walking 20 min most days.","BP 134/82, BMI 31.4. A1C 8.1%, up from 7.6% in June. Foot exam normal.","T2DM above individualized goal. Adherence barrier: shift work.","Discussed adherence strategies. Consider intensification if A1C remains above goal after adherence improves. Recheck A1C in 3 months.",
  ["A1C goal: < 7.5%","Hold escalation: until 2026-11-15 (adherence trial first)","Adherence check-ins: weekly, by text","Contact window: after 6 PM only","Language: Spanish","AI calls: allowed","Do not contact: family members","Notify me directly if: home glucose over 300 twice in a week"]),
 # SYN-009: diabetes on insulin, hypoglycemia
 ("SYN-009","2026-03-01","74 y/o woman with T2DM on basal insulin.","A1C 7.9%.","T2DM at individualized goal (< 8%).","Continue current insulin dose.",None),
 ("SYN-009","2026-07-01","Fasting glucose often over 180.","A1C 8.2%.","T2DM above goal.","Basal insulin dose adjusted. Glucose log every 3 days.",None),
 ("SYN-009","2026-09-01","Two mild low-sugar episodes, treated at home.","A1C 7.6%.","T2DM with mild hypoglycemia.","Hypoglycemia education reviewed. Family aware of symptoms.",
  ["Notify me directly if: any glucose under 60"]),
 # SYN-010: diabetes at goal, A1C overdue; out-of-range AI Plan value
 ("SYN-010","2025-09-10","50 y/o man with T2DM on metformin.","A1C 6.8%.","T2DM at goal.","Continue metformin.",None),
 ("SYN-010","2026-03-15","Doing well.","A1C 6.6%.","T2DM at goal.","Continue metformin. A1C in 6 months.",
  ["A1C goal: < 9.5%"]),
 ("SYN-010","2026-06-20","Telehealth for low back strain after lifting.","No red flags on history.","Mechanical low back pain.","Heat, activity as tolerated. Diabetes labs due in September.",None),
 # SYN-011: stopped logging; no AI calls
 ("SYN-011","2026-02-14","52 y/o woman, annual exam.","BP 132/84.","Elevated office BP.","Home monitoring advised.",None),
 ("SYN-011","2026-08-01","Home log average 136/85.","BP 136/86, PREVENT 5%.","Stage 1 hypertension, low risk.","Lifestyle trial with home monitoring. Review at 3 months.",None),
 ("SYN-011","2026-09-05","Logging most days. Home average 135/84.","BP 134/84.","Stage 1 hypertension, lifestyle trial ongoing.","Continue.",
  ["AI calls: not allowed (prefers to speak with a person)","Contact window: weekday mornings"]),
 # SYN-012: COPD, no pulse oximeter
 ("SYN-012","2025-12-03","69 y/o man with chronic cough and exertional breathlessness.","SpO2 94%.","Chronic cough.","Spirometry ordered.",None),
 ("SYN-012","2026-10-01","Spirometry confirmed COPD.","SpO2 93%.","COPD, GOLD group B.","Started LAMA inhaler. Enrolled in home SpO2 monitoring.",None),
 ("SYN-012","2026-10-20","Phone call. Has not been able to buy a pulse oximeter.","No home readings.","COPD, monitoring not started.","Care team to arrange a device.",
  ["Language: Mandarin"]),
 # SYN-013: on medication, no readings for a month
 ("SYN-013","2026-04-01","63 y/o man. Home log average 158/96.","BP 156/96, PREVENT 9%.","Stage 2 hypertension.","Started fixed-dose combination.",None),
 ("SYN-013","2026-07-01","Home average 146/90.","BP 144/90.","Stage 2 hypertension, not at goal.","Dose increased.",None),
 ("SYN-013","2026-08-05","Phone visit. Tolerating medication. Busy at work.","Home average 142/88.","Stage 2 hypertension, improving.","Keep logging home BP weekly.",
  ["AI calls: allowed"]),
 # SYN-014: forgot to log
 ("SYN-014","2025-09-18","45 y/o woman, annual exam.","BP 128/82.","Elevated BP.","Recheck next year.",None),
 ("SYN-014","2026-03-04","Sinus congestion for 10 days.","BP 134/84, afebrile.","Acute sinusitis. Elevated BP.","Supportive care. Home BP monitoring advised.",None),
 ("SYN-014","2026-09-15","Home log average 133/82.","BP 134/82, PREVENT 6%.","Stage 1 hypertension, low risk.","Lifestyle trial with home monitoring.",
  ["Reminders: text only"]),
 # SYN-015: older patient with falls; individualized BP goal
 ("SYN-015","2025-01-10","82 y/o woman. Home log average 156/88.","BP 158/88.","Stage 2 hypertension.","Started fixed-dose combination.",None),
 ("SYN-015","2026-04-08","Dizzy when standing up quickly.","BP 142/86 seated, 128/80 standing.","Stage 2 hypertension with orthostatic symptoms.","Hydration and slow position changes. Continue regimen.",None),
 ("SYN-015","2026-08-15","Fall at home in July, no injury. Still lightheaded on standing.","BP 136/84 seated, 122/76 standing.","Stage 2 hypertension with orthostatic hypotension and fall risk.","Dose reduced. Physical therapy for balance. Individualized BP goal set.",
  ["BP goal: < 140/90 (age 82, orthostatic dizziness, fall in July 2026)","AI calls: allowed"]),
]

def note_text(pid, date, s, o, a, p, plan):
    lines = [f"SOAP NOTE: {pid}   Date: {date}   Clinician: {CLIN}", "",
             f"S: {s}", f"O: {o}", f"A: {a}", f"P: {p}"]
    if plan:
        lines += ["", "AI PLAN (clinician directives; supersede the note and rule defaults)"]
        lines += [f"- {l}" for l in plan]
    lines += [f"Signed: {CLIN}   {date}"]
    return "\n".join(lines)

rows = []
for i, (pid, date, s, o, a, p, plan) in enumerate(NOTES, start=1):
    rows.append((f"N-{i:03d}", pid, date, CLIN, note_text(pid, date, s, o, a, p, plan)))

with open(os.path.join(HERE, "soap_notes.csv"), "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["note_id", "patient_id", "note_date", "clinician", "note_text"])
    w.writerows(rows)

with open(os.path.join(HERE, "soap_notes_insert.sql"), "w") as f:
    f.write("INSERT INTO CLINICAL_NOTES VALUES\n")
    f.write(",\n".join(f" ('{r[0]}','{r[1]}','{r[2]}','{r[3]}',$${r[4]}$$)" for r in rows))
    f.write(";\n")

print(len(rows), "notes;", sum(1 for n in NOTES if n[6]), "with AI Plan")
