import { cx } from "../cx";
import { Icon } from "../icons";
import { ASK_STEPS, type AskAgentAnswer, type AskStep } from "./questions";
import styles from "./ask.module.css";

export type StepState = "pending" | "active" | "done" | "skipped";
export type StepStatus = Record<AskStep, StepState>;
export type AskPhase = "idle" | "asking" | "answered" | "error";

export interface StepProgressProps {
  steps?: readonly AskStep[];
  status: StepStatus;
  className?: string;
}

const STATE_WORD: Record<StepState, string> = {
  pending: "not started",
  active: "in progress",
  done: "done",
  skipped: "did not run",
};

/** Maps the drawer phase (and the answer, once there is one) to a state per step. */
export function stepStatus(phase: AskPhase, answer: AskAgentAnswer | null): StepStatus {
  if (phase === "asking") return { Understand: "done", Query: "active", Check: "pending", Answer: "pending" };
  if (phase === "error") return { Understand: "done", Query: "pending", Check: "pending", Answer: "pending" };
  if (phase !== "answered" || !answer) return { Understand: "pending", Query: "pending", Check: "pending", Answer: "pending" };
  const query: StepState = answer.source === "recorded" ? "skipped" : "done";
  // No answer text (nothing recorded for this question): only the first steps ran.
  if (!answer.answer?.trim()) return { Understand: "done", Query: query, Check: "pending", Answer: "pending" };
  // safety_terms_ok is null when the medication word check did not run.
  const check: StepState = answer.check?.safety_terms_ok == null ? "skipped" : "done";
  return { Understand: "done", Query: query, Check: check, Answer: "done" };
}

/** Ask steps "Understand · Query · Check · Answer"; active and done steps are machine work, drawn in Marker. */
export function StepProgress({ steps = ASK_STEPS, status, className }: StepProgressProps) {
  const activeIndex = steps.findIndex((step) => status[step] === "active");
  return (
    <div className={cx(styles.progress, className)}>
      <ol className={styles.steps} aria-label="Ask steps">
        {steps.map((step, index) => {
          const state = status[step];
          // A skipped Query step means a recorded answer was used.
          const recorded = state === "skipped" && step === "Query";
          return (
            <li key={step} className={styles.step} data-state={state}>
              {index > 0 ? (
                <span className={styles.stepSep} aria-hidden="true">
                  ·
                </span>
              ) : null}
              <span className={styles.stepGlyph} aria-hidden="true">
                {state === "done" ? <Icon name="check" size={12} /> : <span className={styles.stepDot} />}
              </span>
              <span>{recorded ? "Recorded" : step}</span>
              <span className={styles.srOnly}>: {recorded ? "recorded answer used" : STATE_WORD[state]}</span>
            </li>
          );
        })}
      </ol>
      <span className={styles.srOnly} aria-live="polite">
        {activeIndex >= 0 ? `Step ${activeIndex + 1} of ${steps.length}: ${steps[activeIndex]}` : ""}
      </span>
    </div>
  );
}
