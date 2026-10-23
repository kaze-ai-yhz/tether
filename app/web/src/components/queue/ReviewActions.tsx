"use client";

import { useId, useState } from "react";
import { Button, ReasonDialog, StepLoader, cx, type ActingAs } from "@/components";
import type { QueueItem } from "@/lib/types";
import { EditDialog } from "./EditDialog";
import type { AgentAttempt, useReview } from "./useReview";
import styles from "./queue.module.css";

type Review = ReturnType<typeof useReview>;

export interface ReviewActionsProps {
  item: QueueItem;
  actingAs: ActingAs;
  busy: boolean;
  review: Review["review"];
  tryAsAgent: Review["tryAsAgent"];
  /** "urgent" = red-flag row in the banner: Acknowledge (approve with a note) only. */
  variant?: "card" | "urgent";
}

const AGENT_HINT = "Only a clinician can approve. Snowflake enforces this with roles.";

export function ReviewActions({ item, actingAs, busy, review, tryAsAgent, variant = "card" }: ReviewActionsProps) {
  const hintId = useId();
  const [editOpen, setEditOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [ackOpen, setAckOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<AgentAttempt | null>(null);
  const urgent = variant === "urgent";
  const agent = actingAs === "agent";
  const buttonClass = urgent ? styles.urgentButton : undefined;

  async function approve() {
    setError(null);
    const outcome = await review(item, "APPROVED");
    if (!outcome.ok) setError(outcome.text);
  }

  async function tryApprove() {
    setError(null);
    setAttempt(await tryAsAgent(item));
  }

  return (
    <div className={cx(styles.actions, urgent && styles.urgentActions)}>
      <div className={styles.buttons}>
        {urgent ? (
          <Button
            variant="secondary"
            className={buttonClass}
            isDisabled={agent || busy}
            onPress={() => setAckOpen(true)}
            aria-describedby={agent ? hintId : undefined}
          >
            Acknowledge
          </Button>
        ) : (
          <>
            <Button variant="primary" isDisabled={agent} isPending={busy} onPress={() => void approve()} aria-describedby={agent ? hintId : undefined}>
              Approve
            </Button>
            <Button variant="secondary" icon="pencil" isDisabled={agent || busy} onPress={() => setEditOpen(true)}>
              Edit
            </Button>
            <Button variant="secondary" isDisabled={agent || busy} onPress={() => setRejectOpen(true)}>
              Reject
            </Button>
          </>
        )}
        {agent ? (
          <>
            <span id={hintId} className={cx(styles.hint, urgent && styles.urgentHint)}>
              {AGENT_HINT}
            </span>
            <Button variant="tertiary" className={buttonClass} isDisabled={busy} onPress={() => void tryApprove()}>
              Try approving as Care agent
            </Button>
          </>
        ) : null}
        {busy ? <StepLoader className={urgent ? styles.urgentHint : undefined} /> : null}
      </div>

      {error ? (
        <p className={styles.errorBox} role="alert">
          {error}
        </p>
      ) : null}

      {attempt ? (
        <div className={styles.refusal} role="alert">
          <span className={styles.refusalHead}>
            {attempt.refused
              ? attempt.code === "ROLE_REFUSED"
                ? "Refused by the app's role check"
                : "Snowflake refused the approval"
              : "The approval was not refused by a role check"}
          </span>
          <p className={styles.refusalText}>{attempt.message}</p>
          {attempt.code ? <span className={styles.refusalCode}>{attempt.code}</span> : null}
          {attempt.logged ? <p className={styles.hint}>{attempt.logged}</p> : null}
        </div>
      ) : null}

      <EditDialog
        isOpen={editOpen}
        onOpenChange={setEditOpen}
        patientId={item.patient_id}
        draftText={item.draft_text}
        onSave={async (editedText, note) => {
          const outcome = await review(item, "EDITED", note, editedText);
          return outcome.ok ? null : outcome.text;
        }}
      />
      <ReasonDialog
        isOpen={rejectOpen}
        onOpenChange={setRejectOpen}
        title={`Reject the draft for ${item.patient_id}`}
        description="Nothing is sent. The reason is written to the audit log."
        confirmLabel="Reject draft"
        placeholder="For example: superseded, the rule has moved on"
        destructive
        onConfirm={async (reason) => {
          const outcome = await review(item, "REJECTED", reason);
          if (!outcome.ok) throw new Error(outcome.text);
        }}
      />
      <ReasonDialog
        isOpen={ackOpen}
        onOpenChange={setAckOpen}
        title={`Acknowledge the red flag for ${item.patient_id}`}
        description="Acknowledging records your decision on this alert. The note is written to the audit log."
        label="Note for the record"
        defaultValue="Acknowledged. Clinician is following up with the patient."
        confirmLabel="Acknowledge"
        onConfirm={async (note) => {
          const outcome = await review(item, "APPROVED", note);
          if (!outcome.ok) throw new Error(outcome.text);
        }}
      />
    </div>
  );
}
