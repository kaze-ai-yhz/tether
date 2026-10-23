"use client";

import { Icon, shortCitation, type ActingAs } from "@/components";
import type { QueueItem } from "@/lib/types";
import { parsePrefs } from "./format";
import { ReviewActions } from "./ReviewActions";
import type { useReview } from "./useReview";
import styles from "./queue.module.css";

type Review = ReturnType<typeof useReview>;

export interface UrgentBannerProps {
  items: QueueItem[];
  actingAs: ActingAs;
  busy: ReadonlySet<number>;
  review: Review["review"];
  tryAsAgent: Review["tryAsAgent"];
}

/** Pinned red flags: the one filled alert element on the screen. Acknowledge = approve with a note. */
export function UrgentBanner({ items, actingAs, busy, review, tryAsAgent }: UrgentBannerProps) {
  if (items.length === 0) return null;
  return (
    <section className={styles.urgent} aria-labelledby="urgent-title">
      <h2 id="urgent-title" className={styles.urgentTitle}>
        <Icon name="triangle" />
        {items.length === 1 ? "Red flag" : `Red flags · ${items.length}`}
      </h2>
      <ul className={styles.urgentList}>
        {items.map((item) => (
          <li key={item.action_id} className={styles.urgentRow}>
            <div className={styles.urgentText}>
              <p className={styles.urgentLine}>
                <span className={styles.pid}>{item.patient_id}</span> <strong>{item.display_name}</strong> ·{" "}
                <span className={styles.pid}>{item.rule_id}</span> {item.step}
                {shortCitation(item.citation) ? ` (${shortCitation(item.citation)})` : ""}
              </p>
              <p className={styles.urgentEvidence}>{item.evidence}</p>
              {parsePrefs(item.patient_prefs).length ? (
                <p className={styles.urgentMeta}>
                  From the AI Plan:{" "}
                  {parsePrefs(item.patient_prefs)
                    .map((p) => (p.value ? `${p.label}: ${p.value}` : p.label))
                    .join(" · ")}
                </p>
              ) : null}
              <p className={styles.urgentMeta}>
                {item.kind === "CALL_HANDOFF" ? "Handed off from a simulated check-in call. " : ""}
                Internal alert already sent to the clinician. Fixed text from the rule, no model.
              </p>
            </div>
            <ReviewActions
              item={item}
              actingAs={actingAs}
              busy={busy.has(item.action_id)}
              review={review}
              tryAsAgent={tryAsAgent}
              variant="urgent"
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
