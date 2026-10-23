import { patientsChangePhrase, type ImpactView } from "./rules-format";
import styles from "./rules.module.css";

export interface ImpactSummaryProps {
  impact: ImpactView;
  /** "preview" = "2 patients change", "saved" = "2 patients changed". */
  tense: "preview" | "saved";
  /** Hide the "V_RULE_FIRINGS:" prefix (edit history column). */
  bare?: boolean;
}

/** "→" between two values; screen readers hear "to". */
export function Arrow() {
  return (
    <>
      {" "}
      <span className={styles.arrow} role="img" aria-label="to">
        →
      </span>{" "}
    </>
  );
}

function RuleRef({ id }: { id: string | null }) {
  return id ? <span className={styles.mono}>{id}</span> : <span className={styles.none}>nothing</span>;
}

/** The V_RULE_FIRINGS rows a threshold edit changes, exactly as the proc or RULE_EDITS reports them. */
export function ImpactSummary({ impact, tense, bare = false }: ImpactSummaryProps) {
  return (
    <div className={styles.impact}>
      <p className={styles.impactCount}>
        {bare ? null : <span className={styles.mono}>V_RULE_FIRINGS</span>}
        {bare ? null : ": "}
        {patientsChangePhrase(impact.count, tense)}
      </p>
      {impact.changes.length > 0 ? (
        <ul className={styles.impactList}>
          {impact.changes.map((change, index) => (
            <li key={`${change.patientId}-${change.condition ?? ""}-${index}`}>
              <span className={styles.mono}>{change.patientId}</span>
              {": "}
              <RuleRef id={change.before} />
              <Arrow />
              <RuleRef id={change.after} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
