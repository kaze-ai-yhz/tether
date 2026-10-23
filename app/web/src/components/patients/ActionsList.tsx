import { LayerChip, MessageQuote, ModelChip, StatusChip, formatSimDate } from "@/components";
import type { PatientAction } from "@/lib/types";
import type { CitationLookup } from "./TodosTable";
import { RECIPIENT_LABEL, channelLabel, conditionLabel, formatStamp, sentenceCase, splitWhy } from "./format";
import { ToneChip } from "./ToneChip";
import styles from "./patients.module.css";

const DECISION_VERB: Partial<Record<PatientAction["status"], string>> = {
  APPROVED: "Approved",
  EDITED: "Edited and approved",
  REJECTED: "Rejected",
};

function DraftSource({ action }: { action: PatientAction }) {
  if (!action.model && !action.draft_source) {
    return <ToneChip tone="neutral" label="Draft source not recorded" />;
  }
  return <ModelChip model={action.model} source={action.draft_source} size="sm" />;
}

/** The clinician's decision on the draft, drawn in Ink. */
function Decision({ action }: { action: PatientAction }) {
  if (!action.reviewed_by && !action.reviewed_at) {
    return action.status === "PENDING" ? <span className={styles.muted}>Waiting for a clinician in the queue</span> : null;
  }
  const verb = DECISION_VERB[action.status] ?? "Reviewed";
  return (
    <p className={styles.decision}>
      {verb} by {action.reviewed_by ?? "an unrecorded user"}
      {action.reviewed_at ? ` · ${formatStamp(action.reviewed_at)}` : null}
      {action.review_note ? <span className={styles.decisionNote}> · “{action.review_note}”</span> : null}
    </p>
  );
}

function ActionCard({ action, citations }: { action: PatientAction; citations: CitationLookup }) {
  const { body, why } = splitWhy(action.draft_text);
  const redFlag = action.kind === "RED_FLAG" || action.kind === "CALL_HANDOFF" || action.action_type === "URGENT_ALERT";
  const sends = action.sends ?? [];
  const titleId = `action-${action.action_id}`;
  return (
    <article className={styles.card} aria-labelledby={titleId}>
      <div className={styles.cardHead}>
        <StatusChip status={action.status} size="sm" />
        {redFlag ? <ToneChip tone="alert" icon="triangle" label="Red flag" /> : null}
        <h3 id={titleId} className={styles.cardTitle}>
          <span className={styles.mono}>{action.rule_id}</span>
          <span>{action.step ?? (action.action_type ? sentenceCase(action.action_type) : "Draft")}</span>
        </h3>
        {action.layer ? <LayerChip layer={action.layer} citation={citations[action.rule_id]?.citation ?? null} size="sm" /> : null}
        <span className={styles.cardMeta}>
          Action #{action.action_id}
          {action.sim_date ? ` · drafted ${formatSimDate(action.sim_date)} (simulated)` : null}
        </span>
      </div>
      <p className={styles.cardLine}>
        To <strong>{RECIPIENT_LABEL[action.recipient] ?? action.recipient}</strong>
        {action.channel ? (
          <>
            {" "}
            · channel <strong>{channelLabel(action.channel)}</strong>
          </>
        ) : null}{" "}
        · {conditionLabel(action.condition)}
      </p>
      {action.evidence ? <p className={styles.cardLine}>Evidence: {action.evidence}</p> : null}
      <MessageQuote
        footer={
          sends.length ? (
            <span className={styles.sends}>
              {sends.map((send) => (
                <span key={send.msg_id}>
                  Sent via {channelLabel(send.channel)} · {send.provider}
                  {send.sent_sim ? ` · ${formatSimDate(send.sent_sim)}` : send.sent_at ? ` · ${formatStamp(send.sent_at)}` : null}
                </span>
              ))}
            </span>
          ) : undefined
        }
      >
        {body || "(empty draft)"}
      </MessageQuote>
      {why ? <p className={styles.why}>Why: {why}</p> : null}
      <div className={styles.cardFoot}>
        <DraftSource action={action} />
        <Decision action={action} />
      </div>
    </article>
  );
}

/** Every draft for the patient, newest first, with its status, sends and the clinician's decision. */
export function ActionsList({ actions, citations }: { actions: PatientAction[]; citations: CitationLookup }) {
  if (actions.length === 0) {
    return <p className={styles.emptyLine}>No drafts for this patient yet.</p>;
  }
  const sorted = [...actions].sort(
    (a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? "") || b.action_id - a.action_id,
  );
  return (
    <ol className={styles.cards}>
      {sorted.map((action) => (
        <li key={action.action_id}>
          <ActionCard action={action} citations={citations} />
        </li>
      ))}
    </ol>
  );
}
