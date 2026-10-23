import { Fragment } from "react";
import { MessageQuote, ModelChip, SimulatedTag, formatSimDate } from "@/components";
import type { CallTranscript, PatientDetail } from "@/lib/types";
import { answerEntries, callOutcomeSpec } from "./format";
import { SimulateCalls, type ReadyCall } from "./SimulateCalls";
import { ToneChip } from "./ToneChip";
import styles from "./patients.module.css";

const SCENARIO_LABEL: Record<string, string> = {
  ANSWERED: "answered with a reading",
  NO_ANSWER: "no answer",
  CHEST_PAIN: "reports chest pain",
};

function CallCard({ call }: { call: CallTranscript }) {
  const answers = answerEntries(call.answers);
  const titleId = `call-${call.call_id}`;
  return (
    <article className={styles.card} aria-labelledby={titleId}>
      <div className={styles.cardHead}>
        <ToneChip {...callOutcomeSpec(call.outcome)} />
        <h3 id={titleId} className={styles.cardTitle}>
          <span>Attempt {call.attempt}</span>
          {call.rule_id ? <span className={styles.mono}>{call.rule_id}</span> : null}
        </h3>
        <SimulatedTag label="Simulated call" />
        <span className={styles.cardMeta}>
          Action #{call.action_id}
          {call.at_sim ? ` · ${formatSimDate(call.at_sim)} (simulated)` : null}
        </span>
      </div>
      <MessageQuote
        footer={
          <>
            {call.model ? (
              <ModelChip action="Transcript written" model={call.model} size="sm" />
            ) : (
              <span>Template transcript · no model</span>
            )}
            {call.scenario ? <span>Scenario: {SCENARIO_LABEL[call.scenario] ?? call.scenario}</span> : null}
          </>
        }
      >
        {call.transcript || "(no transcript)"}
      </MessageQuote>
      {answers.length ? (
        <dl className={styles.answers} aria-label="Answers logged from the call">
          {answers.map(([label, value]) => (
            <Fragment key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </Fragment>
          ))}
        </dl>
      ) : null}
    </article>
  );
}

export interface CallsSectionProps {
  patient: PatientDetail;
  /** This patient's calls that are ready to simulate (V_APP_STATE.call_ready). */
  ready: ReadyCall[];
}

/** Simulated AI check-in calls: consent on file, the simulate controls, and every transcript. */
export function CallsSection({ patient, ready }: CallsSectionProps) {
  const calls = [...patient.calls].sort((a, b) => b.call_id - a.call_id);
  const aiCalls = patient.active_overrides.find((o) => o.setting === "AI_CALLS") ?? null;
  const consent =
    patient.ai_call_consent === true ? "Yes" : patient.ai_call_consent === false ? "No" : "Not recorded";
  return (
    <>
      <p className={styles.cardLine}>
        Consent to AI calls on file: <strong>{consent}</strong>
        {aiCalls ? (
          <>
            {" "}
            · AI Plan: AI calls <strong>{aiCalls.raw_value}</strong> (<span className={styles.mono}>{aiCalls.note_id}</span>)
          </>
        ) : null}
      </p>
      <SimulateCalls patientId={patient.patient_id} ready={ready} />
      {calls.length === 0 ? (
        <p className={styles.emptyLine}>
          No check-in calls yet. A call is drafted when the ladder reaches ENG-3 and runs only after a clinician approves
          it; without consent to AI calls the care team calls instead (ENG-3H).
        </p>
      ) : (
        <ol className={styles.cards}>
          {calls.map((call) => (
            <li key={call.call_id}>
              <CallCard call={call} />
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
