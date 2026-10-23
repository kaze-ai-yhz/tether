import type { WriteResult } from "./useWrite";
import styles from "./patients.module.css";

export interface WriteOutcomeProps {
  result: WriteResult | null;
  okLead: string;
  errorLead: string;
}

/** The last write's result, shown as returned (the shell's live region announces it). */
export function WriteOutcome({ result, okLead, errorLead }: WriteOutcomeProps) {
  if (!result) return null;
  const fixtureNote = result.fixtures && !/fixture/i.test(result.text);
  return (
    <p className={styles.outcome} data-tone={result.ok ? "ok" : "error"}>
      <span className={styles.outcomeLead}>{result.ok ? okLead : errorLead}</span>
      <span>{result.text}</span>
      {fixtureNote ? <span className={styles.muted}>Fixture mode: nothing changed in Snowflake.</span> : null}
      {result.code ? <span className={styles.outcomeCode}>{result.code}</span> : null}
    </p>
  );
}
