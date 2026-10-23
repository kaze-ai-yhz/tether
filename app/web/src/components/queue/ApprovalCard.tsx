"use client";

import { LayerChip, MessageQuote, SimulatedTag, Sparkline, StatusChip, cx, type ActingAs } from "@/components";
import chips from "@/components/chips.module.css";
import type { QueueItem } from "@/lib/types";
import { DraftSourceChip } from "./DraftSourceChip";
import {
  CONDITION_LABEL,
  PLAN_STATUS_LABEL,
  READING_LABEL,
  RECIPIENT_LABEL,
  channelHint,
  parsePrefs,
  planLineFromEvidence,
  type ReadingSeries,
} from "./format";
import { ReviewActions } from "./ReviewActions";
import type { useReview } from "./useReview";
import styles from "./queue.module.css";

type Review = ReturnType<typeof useReview>;

export interface ApprovalCardProps {
  item: QueueItem;
  series: ReadingSeries | null;
  actingAs: ActingAs;
  busy: boolean;
  review: Review["review"];
  tryAsAgent: Review["tryAsAgent"];
}

const KIND_LABEL: Partial<Record<QueueItem["kind"], string>> = {
  CALL_RETRY: "Retry of a missed check-in call",
  CALL_ESCALATION: "Two check-in calls missed",
};

function whyText(why: string | null): string | null {
  if (!why) return null;
  return why.replace(/^\s*Why:\s*/i, "");
}

function quoteFooter(item: QueueItem) {
  const hint = channelHint(item.action_type, item.recipient);
  if (item.action_type === "CARE_TEAM_CALL") return <span>Call brief for a care-team member · not sent to the patient</span>;
  if (item.action_type === "AI_CHECKIN_CALL") {
    return (
      <span className={styles.quoteFooter}>
        <span>Check-in call script · runs only after approval</span>
        <SimulatedTag label="Simulated call" />
      </span>
    );
  }
  return <span>{hint}</span>;
}

export function ApprovalCard({ item, series, actingAs, busy, review, tryAsAgent }: ApprovalCardProps) {
  const titleId = `draft-${item.action_id}`;
  const plan = item.condition === "PLAN" ? planLineFromEvidence(item.evidence) : null;
  const prefs = parsePrefs(item.patient_prefs);
  const why = whyText(item.why_text);
  const kind = KIND_LABEL[item.kind];
  const careTeamCall = item.action_type === "CARE_TEAM_CALL";

  return (
    <article className={cx(styles.card, item.stale && styles.cardStale)} aria-labelledby={titleId}>
      <header className={styles.head}>
        <div className={styles.who}>
          <span className={styles.pid}>{item.patient_id}</span>
          <span className={styles.name}>{item.display_name}</span>
          <span className={styles.condition}>{CONDITION_LABEL[item.condition] ?? item.condition}</span>
        </div>
        <div className={styles.chipRow}>
          <LayerChip layer={item.layer} citation={item.citation} ruleId={item.rule_id} size="sm" />
          {item.layer === "P2" && item.override_note_id ? (
            <span className={styles.meta}>note {item.override_note_id}</span>
          ) : null}
          {item.stale && item.current_rule_id ? (
            <span className={cx(chips.chip, chips.sm, chips.caution)}>Rule now at {item.current_rule_id}</span>
          ) : null}
          <StatusChip status="PENDING" size="sm" />
        </div>
      </header>

      <div className={styles.titleRow}>
        <h3 id={titleId}>{careTeamCall ? `Care-team call: ${item.step}` : item.step}</h3>
        <span className={styles.ruleId}>{item.rule_id}</span>
        {kind ? <span className={styles.meta}>{kind}</span> : null}
      </div>
      <p className={styles.citation}>{item.citation}</p>

      <div className={styles.body}>
        <div className={styles.evidenceCol}>
          {plan ? (
            <div className={styles.planReview}>
              <MessageQuote
                footer={
                  <span className={styles.quoteFooter}>
                    <span>AI Plan line · note {plan.noteId}</span>
                    {plan.status ? (
                      <span
                        className={cx(
                          chips.chip,
                          chips.sm,
                          plan.status === "SAFETY_BLOCKED" ? chips.alert : chips.caution,
                        )}
                      >
                        {PLAN_STATUS_LABEL[plan.status]}
                      </span>
                    ) : null}
                  </span>
                }
              >
                {plan.line}
              </MessageQuote>
              {plan.tail ? <p className={styles.evidence}>Not applied: {plan.tail}.</p> : null}
            </div>
          ) : (
            <p className={styles.evidence}>
              Rule <span className={styles.ruleInline}>{item.rule_id}</span> fired: {item.evidence}
            </p>
          )}
          <p className={styles.route}>
            <span>
              To: <strong>{RECIPIENT_LABEL[item.recipient] ?? item.recipient}</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>{channelHint(item.action_type, item.recipient)}</span>
          </p>
          {prefs.length ? (
            <ul className={styles.prefs} aria-label="Patient preferences from the AI Plan">
              {prefs.map((p) => (
                <li key={p.key} className={cx(chips.chip, chips.sm, chips.neutral)}>
                  {p.label}
                  {p.value ? `: ${p.value}` : ""}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {series ? (
          <figure className={styles.readings}>
            <Sparkline
              points={item.recent_readings.map((r) => ({ label: r.taken_on, value: r.value1, value2: r.value2 }))}
              label={`${item.patient_id} ${READING_LABEL[series.readingType] ?? series.readingType}, last ${item.recent_readings.length} readings`}
              threshold={series.threshold}
              thresholdLabel={series.thresholdLabel}
              unit={series.unit}
            />
            <figcaption className={styles.meta}>Synthetic data</figcaption>
          </figure>
        ) : null}
      </div>

      <div className={styles.draft}>
        <div className={styles.draftHead}>
          <span className={styles.draftLabel}>{careTeamCall ? "Call brief" : "Draft"}</span>
          <DraftSourceChip source={item.draft_source} model={item.model} size="sm" />
        </div>
        <MessageQuote footer={quoteFooter(item)}>{item.draft_body || item.draft_text}</MessageQuote>
        {why ? (
          <p className={styles.why}>
            <span className={styles.whyLabel}>Why:</span> {why}
          </p>
        ) : null}
        {item.safety_ok === false ? (
          <p className={styles.safety} role="note">
            Did not pass the drug and dose check{item.safety_notes ? `: ${item.safety_notes}` : ""}. It cannot be sent as is.
          </p>
        ) : null}
      </div>

      <ReviewActions item={item} actingAs={actingAs} busy={busy} review={review} tryAsAgent={tryAsAgent} />
    </article>
  );
}
