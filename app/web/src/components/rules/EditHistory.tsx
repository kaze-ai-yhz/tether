import type { RuleEdit } from "@/lib/types";
import { cx } from "../cx";
import { Arrow, ImpactSummary } from "./ImpactSummary";
import { fieldLabel, formatTimestamp, formatValue, readImpact } from "./rules-format";
import styles from "./rules.module.css";

/** RULE_EDITS, newest first: who, when, field old → new, reason, patients whose firing changed. */
export function EditHistory({ edits }: { edits: RuleEdit[] }) {
  return (
    <section id="rules-history" aria-labelledby="rules-history-title" className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 id="rules-history-title">Edit history</h2>
        <span className={styles.groupCount}>
          {edits.length} {edits.length === 1 ? "edit" : "edits"} from RULE_EDITS, newest first
        </span>
      </div>
      {edits.length === 0 ? (
        <p className={styles.emptyNote}>
          No threshold edits yet. Each saved edit is listed here with who made it, when, the reason and the patients
          whose firing changed.
        </p>
      ) : (
        <div className={styles.tableScroll}>
          <table className={cx(styles.table, styles.historyTable)}>
            <caption className="visually-hidden">Threshold edits, newest first</caption>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Who</th>
                <th scope="col">Rule</th>
                <th scope="col">Change</th>
                <th scope="col">Reason</th>
                <th scope="col">Patients changed</th>
              </tr>
            </thead>
            <tbody>
              {edits.map((edit, index) => {
                const impact = readImpact(edit.impact);
                return (
                  <tr key={edit.edit_id ? String(edit.edit_id) : `edit-${index}`}>
                    <td className={styles.nowrap}>
                      {edit.edited_at ? (
                        <time dateTime={edit.edited_at}>{formatTimestamp(edit.edited_at)}</time>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{edit.edited_by || "—"}</td>
                    <td>
                      <span className={styles.ruleId}>{edit.rule_id}</span>
                    </td>
                    <td className={styles.nowrap}>
                      {fieldLabel(edit.field)}: {formatValue(edit.old_value) ?? "—"}
                      <Arrow />
                      {formatValue(edit.new_value) ?? "—"}
                    </td>
                    <td className={styles.reason}>{edit.reason}</td>
                    <td>{impact ? <ImpactSummary impact={impact} tense="saved" bare /> : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
