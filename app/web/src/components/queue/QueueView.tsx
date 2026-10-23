"use client";

import { useState } from "react";
import { Button, ConfirmDialog, EmptyState, cx, useShell } from "@/components";
import { HeroArt } from "@/components/art";
import type { AppState, HeldItem, QueueItem, RuleRow } from "@/lib/types";
import { ApprovalCard } from "./ApprovalCard";
import { seriesFor } from "./format";
import { HeldList } from "./HeldList";
import { UrgentBanner } from "./UrgentBanner";
import { useReview } from "./useReview";
import styles from "./queue.module.css";

export interface QueueViewProps {
  state: AppState | null;
  items: QueueItem[];
  held: HeldItem[];
  /** V_RULES threshold1 by rule id, for sparkline reference lines. */
  thresholds: Record<string, Pick<RuleRow, "threshold1">>;
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function QueueView({ state, items, held, thresholds }: QueueViewProps) {
  const { actingAs } = useShell();
  const { busy, review, approveMany, tryAsAgent } = useReview();
  const [batchOpen, setBatchOpen] = useState(false);
  const urgent = items.filter((i) => i.is_red_flag);
  const cards = items.filter((i) => !i.is_red_flag);
  const batchable = cards.filter((i) => i.batchable);
  const agent = actingAs === "agent";

  return (
    <>
      <div className={cx(styles.hero, "motion-enter")}>
        <HeroArt className={styles.heroArt} />
        <header className={cx("page-header", styles.heroHeader)}>
          <div className={styles.heading}>
            <h1>Approval queue</h1>
            {state ? (
              <p
                key={`${state.pending_count}-${state.red_flag_count}-${state.needs_clinician_count}`}
                className={cx(styles.counts, "motion-tick")}
              >
                {count(state.pending_count, "draft", "drafts")} waiting · {count(state.red_flag_count, "red flag", "red flags")} ·{" "}
                {count(state.needs_clinician_count, "patient needs", "patients need")} a clinician
              </p>
            ) : null}
            <p>Nothing is sent until a clinician approves, edits or rejects it.</p>
          </div>
          {batchable.length > 0 ? (
            <Button
              variant="secondary"
              isDisabled={agent || batchable.some((i) => busy.has(i.action_id))}
              onPress={() => setBatchOpen(true)}
            >
              Approve all reading reminders ({batchable.length})
            </Button>
          ) : null}
        </header>
      </div>

      <UrgentBanner items={urgent} actingAs={actingAs} busy={busy} review={review} tryAsAgent={tryAsAgent} />

      {cards.length === 0 && urgent.length === 0 ? (
        <EmptyState
          art="empty-queue"
          title="No drafts waiting"
          description="A clinician approves every outbound action."
          className="motion-enter"
        />
      ) : (
        <div className={cx(styles.list, "motion-stagger")}>
          {cards.map((item, index) => (
            <ApprovalCard
              key={item.action_id}
              staggerIndex={index}
              item={item}
              series={seriesFor(item, thresholds)}
              actingAs={actingAs}
              busy={busy.has(item.action_id)}
              review={review}
              tryAsAgent={tryAsAgent}
            />
          ))}
        </div>
      )}

      <HeldList items={held} />

      <ConfirmDialog
        isOpen={batchOpen}
        onOpenChange={setBatchOpen}
        title={`Approve ${count(batchable.length, "reading reminder", "reading reminders")}`}
        confirmLabel="Approve reminders"
        onConfirm={async () => {
          const failures = await approveMany(batchable);
          if (failures.length) throw new Error(failures.join("\n"));
        }}
      >
        <p>Each reminder is sent by SMS (simulated) after approval. Other drafts are reviewed one at a time.</p>
        <ul className={styles.batchList}>
          {batchable.map((i) => (
            <li key={i.action_id}>
              <span className={styles.pid}>{i.patient_id}</span> {i.display_name} · {i.step}
            </li>
          ))}
        </ul>
      </ConfirmDialog>
    </>
  );
}
