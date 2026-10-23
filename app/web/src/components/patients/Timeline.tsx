import type { TimelineEvent } from "@/lib/types";
import { actorKind, actorLabel, eventLabel, formatStampSeconds } from "./format";
import styles from "./patients.module.css";

/** V_TIMELINE (AUDIT_LOG for the patient) as an ordered list, newest first, time as text. */
export function Timeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return <p className={styles.emptyLine}>No audit events for this patient yet.</p>;
  }
  return (
    <ol className={styles.timeline} aria-label="Audit events, newest first">
      {events.map((event, i) => (
        <li key={`${event.logged_at}-${event.event}-${i}`} className={styles.event}>
          <time className={styles.eventTime} dateTime={event.logged_at}>
            {formatStampSeconds(event.logged_at)}
          </time>
          <span className={styles.glyph} data-kind={actorKind(event.actor)} aria-hidden="true" />
          <div className={styles.eventText}>
            <span className={styles.eventName}>{eventLabel(event.event)}</span>
            <span className={styles.eventActor}>by {actorLabel(event.actor)}</span>
            {event.action_id !== null ? <span className={`${styles.mono} ${styles.muted}`}>#{event.action_id}</span> : null}
            {event.detail ? <span className={styles.eventDetail}>{event.detail}</span> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
