import { ModelChip } from "@/components";
import type { ClinicalNote, PatientDetail } from "@/lib/types";
import { OVERRIDE_STATUS_NOTE, isDirectiveLine, overrideFor, overrideSpec, pairReadings, readingOf, type AiPlanText } from "./format";
import { ReadAiPlan } from "./ReadAiPlan";
import { ToneChip } from "./ToneChip";
import styles from "./patients.module.css";

export interface AiPlanBlockProps {
  note: ClinicalNote;
  plan: AiPlanText;
  patient: PatientDetail;
  /** The newest note with an AI Plan, the one READ_AI_PLAN reads for this patient. */
  isLatestPlan: boolean;
}

/**
 * The signed AI PLAN block, one row per line: the clinician's text (Ink), the status Faiz's
 * V_PATIENT_OVERRIDES gave it, and Claude's plain-language reading (Marker) when there is one.
 */
export function AiPlanBlock({ note, plan, patient, isLatestPlan }: AiPlanBlockProps) {
  const carePlan = patient.plan && patient.plan.note_id === note.note_id ? patient.plan : null;
  const reading = readingOf(carePlan);
  const paired = reading ? pairReadings(plan.lines, reading.lines) : null;
  const headingId = `ai-plan-${note.note_id}`;

  return (
    <section className={styles.plan} aria-labelledby={headingId}>
      <h4 id={headingId} className={styles.planHeader}>
        {plan.header}
      </h4>

      {reading ? (
        <div className={styles.planReadingBlock}>
          <div className={styles.planReadingHead}>
            <ModelChip action="Read" model={carePlan?.reading_model} size="sm" />
            <span className={styles.caption}>Claude explains; the rules decide.</span>
          </div>
          {reading.summary ? <p>{reading.summary}</p> : null}
        </div>
      ) : isLatestPlan ? (
        <p className={styles.caption}>Claude has not read this AI Plan yet. The statuses below come from the rules either way.</p>
      ) : null}

      <table className={styles.planTable}>
        <thead>
          <tr>
            <th scope="col" className={styles.planColLine}>
              Signed line
            </th>
            <th scope="col" className={styles.planColStatus}>
              Rules decision
            </th>
            {reading ? <th scope="col">Claude&apos;s reading</th> : null}
          </tr>
        </thead>
        <tbody>
          {plan.lines.map((line, i) => {
            const directive = isDirectiveLine(line);
            const override = directive ? overrideFor(patient.overrides, note.note_id, line) : undefined;
            const active = override?.setting
              ? patient.active_overrides.find((a) => a.setting === override.setting)
              : undefined;
            const supersededBy =
              override?.status === "APPLIED" && active && active.note_id !== note.note_id ? active.note_id : null;
            const explain = supersededBy
              ? `Superseded by note ${supersededBy}; the latest signed note wins.`
              : override
                ? OVERRIDE_STATUS_NOTE[override.status]
                : null;
            const readingLine = reading && paired && paired.index[i] >= 0 ? reading.lines[paired.index[i]] : null;
            return (
              <tr key={`${i}-${line}`}>
                <td>
                  <div className={styles.planLine}>
                    <div className={styles.planLineText}>{line}</div>
                    {explain ? <div className={styles.planLineNote}>{explain}</div> : null}
                  </div>
                </td>
                <td className={styles.planColStatus}>
                  {override ? (
                    <ToneChip {...overrideSpec(override.status)} />
                  ) : (
                    <span className={styles.muted}>{directive ? "Not evaluated" : "Not a directive line"}</span>
                  )}
                </td>
                {reading ? (
                  <td>
                    {readingLine ? (
                      <div className={styles.planReading}>
                        <div>{readingLine.meaning}</div>
                        {readingLine.concern ? (
                          <div className={styles.concern}>
                            <span className={styles.concernLabel}>Concern:</span> {readingLine.concern}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <span className={styles.planReadingNone}>No reading for this line</span>
                    )}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>

      {plan.signature ? (
        <p className={styles.planSignature}>{plan.signature}</p>
      ) : (
        <p className={styles.muted}>This AI Plan block is not signed.</p>
      )}

      {paired && paired.unpaired.length ? (
        <div className={styles.planReadingBlock}>
          <span className={styles.caption}>Also in Claude&apos;s reading</span>
          <ul className={styles.plainList}>
            {paired.unpaired.map((r, i) => (
              <li key={i}>
                {r.line ? <span className={styles.mono}>{r.line}</span> : null} {r.meaning}
                {r.concern ? (
                  <span className={styles.concern}>
                    {" "}
                    <span className={styles.concernLabel}>Concern:</span> {r.concern}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {isLatestPlan ? <ReadAiPlan noteId={note.note_id} patientId={patient.patient_id} canRead={!reading} /> : null}
    </section>
  );
}
