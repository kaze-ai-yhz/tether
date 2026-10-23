"use client";

import { Button, SimulatedTag, StepLoader } from "@/components";
import type { CallScenario } from "@/lib/types";
import { useWrite } from "./useWrite";
import { WriteOutcome } from "./WriteOutcome";
import styles from "./patients.module.css";

const SCENARIOS: ReadonlyArray<{ scenario: CallScenario; label: string }> = [
  { scenario: "ANSWERED", label: "Simulate: answered with a reading" },
  { scenario: "NO_ANSWER", label: "Simulate: no answer" },
  { scenario: "CHEST_PAIN", label: "Simulate: reports chest pain" },
];

export interface ReadyCall {
  action_id: number;
  rule_id: string | null;
  step: string | null;
}

export interface SimulateCallsProps {
  patientId: string;
  /** This patient's entries in V_APP_STATE.call_ready (approved and sent AI check-in calls). */
  ready: ReadyCall[];
}

/**
 * Buttons that run SIMULATE_CHECKIN_CALL for an approved, sent check-in call. No real call is
 * placed. The last outcome stays visible after the page refreshes.
 */
export function SimulateCalls({ patientId, ready }: SimulateCallsProps) {
  const { busy, result, run } = useWrite("call");
  if (ready.length === 0 && !result) return null;

  function simulate(actionId: number, scenario: CallScenario) {
    void run(`${actionId}:${scenario}`, `/api/calls/${actionId}/simulate`, { scenario }, (ok, text) =>
      ok ? `${patientId}: simulated call recorded. ${text}` : `${patientId}: the simulated call did not run. ${text}`,
    );
  }

  return (
    <div className={styles.simulate}>
      {ready.map((call) => (
        <div key={call.action_id} className={styles.planActions}>
          <p className={styles.cardLine}>
            Check-in call <span className={styles.mono}>#{call.action_id}</span>
            {call.rule_id ? (
              <>
                {" "}
                (<span className={styles.mono}>{call.rule_id}</span>
                {call.step ? ` · ${call.step}` : null})
              </>
            ) : null}{" "}
            was approved and sent. Choose how the call goes. <SimulatedTag label="Simulated call" />
          </p>
          <div className={styles.simulateButtons} role="group" aria-label={`Simulate check-in call ${call.action_id}`}>
            {SCENARIOS.map(({ scenario, label }) => (
              <Button
                key={scenario}
                size="sm"
                isDisabled={busy !== null && busy !== `${call.action_id}:${scenario}`}
                isPending={busy === `${call.action_id}:${scenario}`}
                onPress={() => simulate(call.action_id, scenario)}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
      ))}
      {busy ? <StepLoader label="Simulating the call…" /> : null}
      <WriteOutcome result={result} okLead="Call simulated." errorLead="Call not simulated." />
    </div>
  );
}
