import { Icon, formatSimDate } from "@/components";
import type { HeldItem } from "@/lib/types";
import styles from "./queue.module.css";

/** Escalations a clinician held in the AI Plan. Not drafts: nothing here can be approved or sent. */
export function HeldList({ items }: { items: HeldItem[] }) {
  if (items.length === 0) return null;
  return (
    <section className={styles.section} aria-labelledby="held-title">
      <h2 id="held-title">Held by the clinician</h2>
      <p className={styles.sectionNote}>
        These rules fired but the clinician held the escalation in the AI Plan. Red flags are never held.
      </p>
      <ul className={styles.heldList}>
        {items.map((item) => (
          <li key={`${item.patient_id}-${item.held_rule}`} className={styles.held}>
            <Icon name="clock" />
            <div className={styles.heldText}>
              <p>
                <span className={styles.pid}>{item.patient_id}</span> <strong>{item.display_name}</strong> ·{" "}
                <span className={styles.pid}>{item.held_rule}</span>
              </p>
              <p>
                Escalation held until {formatSimDate(item.held_until) ?? item.held_until} by the clinician (note{" "}
                {item.note_id})
              </p>
              <p className={styles.meta}>{item.evidence}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
