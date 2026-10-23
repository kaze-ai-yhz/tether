import { Fragment } from "react";
import type { OverrideKey } from "@/lib/types";
import { cx } from "../cx";
import { acceptedRange } from "./rules-format";
import styles from "./rules.module.css";

/** HOLD_ESCALATION_UNTIL may wrap after an underscore; the text itself is unchanged. */
function withWordBreaks(id: string) {
  return String(id ?? "")
    .split("_")
    .map((part, index) => (
      <Fragment key={index}>
        {index > 0 ? (
          <>
            _<wbr />
          </>
        ) : null}
        {part}
      </Fragment>
    ));
}

const TYPE_LABEL: Record<string, string> = {
  NUM: "Number",
  BP: "Blood pressure",
  DATE: "Date",
  YESNO: "Yes or no",
  TEXT: "Text",
};

export interface AiPlanKeysCardProps {
  keys: OverrideKey[];
  /** Faiz's SAFETY_LOCKED_TERMS. */
  terms: string[];
}

/** Read-only: Faiz's OVERRIDE_KEYS (what an AI Plan line may set) and SAFETY_LOCKED_TERMS. */
export function AiPlanKeysCard({ keys, terms }: AiPlanKeysCardProps) {
  return (
    <section id="rules-ai-plan-keys" aria-labelledby="rules-keys-title" className={styles.card}>
      <div className={styles.sectionHead}>
        <h2 id="rules-keys-title">AI Plan keys (defined by Dr. Faiz)</h2>
        <span className={styles.readOnly}>Read-only</span>
      </div>
      <p className={styles.sectionLead}>
        A clinician customizes follow-up with signed <span className={styles.mono}>- Key: value</span> lines in a
        note&apos;s AI PLAN block. V_PATIENT_OVERRIDES applies a line only when its value is in the accepted range;
        any other line is not applied and goes to the clinician for review.
      </p>
      {keys.length === 0 ? (
        <p className={styles.emptyNote}>OVERRIDE_KEYS returned no rows.</p>
      ) : (
        <div className={styles.tableScroll}>
          <table className={cx(styles.table, styles.keysTable)}>
            <caption className="visually-hidden">OVERRIDE_KEYS: AI Plan keys and the values they accept</caption>
            <thead>
              <tr>
                <th scope="col">Key</th>
                <th scope="col">Setting</th>
                <th scope="col">Type</th>
                <th scope="col">Accepted range</th>
                <th scope="col">Description</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={`${key.setting}-${key.key_prefix}`}>
                  <th scope="row">
                    <span className={styles.mono}>{key.key_prefix}</span>
                  </th>
                  <td>
                    <span className={styles.mono}>{withWordBreaks(key.setting)}</span>
                  </td>
                  <td>{TYPE_LABEL[String(key.value_type).toUpperCase()] ?? key.value_type}</td>
                  <td>{acceptedRange(key)}</td>
                  <td>{key.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className={styles.termsBlock}>
        <h3 className={styles.subTitle}>Locked terms</h3>
        {terms.length > 0 ? (
          <ul className={styles.terms} aria-label="SAFETY_LOCKED_TERMS">
            {terms.map((term) => (
              <li key={term} className={styles.term}>
                {term}
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.termsCaption}>SAFETY_LOCKED_TERMS returned no rows.</p>
        )}
        <p className={styles.termsCaption}>Lines containing these words are blocked and sent to the clinician</p>
      </div>
    </section>
  );
}
