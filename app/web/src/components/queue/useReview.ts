"use client";

import { useCallback, useState } from "react";
import { announce, postJson, useShell, type ApiOutcome } from "@/components";
import type { ProcResult, QueueItem, ReviewDecision, ReviewResult } from "@/lib/types";
import { channelWord } from "./format";

/** What happened when the Care agent tried to approve: the server's words, verbatim. */
export interface AgentAttempt {
  /** True when the approval was refused: by Snowflake (SNOWFLAKE_REFUSED) or by the app's role check (ROLE_REFUSED). */
  refused: boolean;
  message: string;
  code: string | null;
  /** Result of logging the refusal as REVIEW_DENIED, or null if nothing was logged. */
  logged: string | null;
}

function announcement(item: QueueItem, decision: ReviewDecision, outcome: ApiOutcome<ReviewResult>): string {
  const who = item.patient_id;
  if (decision === "REJECTED") {
    return `Draft rejected for ${who}${outcome.fixtures ? " · fixture mode, nothing was saved" : ""}`;
  }
  const what = item.is_red_flag
    ? `Red flag acknowledged for ${who}`
    : item.condition === "PLAN"
      ? `AI Plan review approved for ${who}`
      : `${decision === "EDITED" ? "Edited draft" : "Draft"} approved for ${who}`;
  const channel = outcome.data && typeof outcome.data.channel === "string" ? outcome.data.channel : null;
  return `${what} · ${outcome.fixtures ? "fixture mode, nothing was sent" : channelWord(item, channel)}`;
}

/** Posts reviews through /api/queue/:id/review as the acting role; Snowflake enforces who may approve. */
export function useReview() {
  const { notifyChanged } = useShell();
  const [busy, setBusy] = useState<ReadonlySet<number>>(new Set());

  const mark = useCallback((ids: number[], on: boolean) => {
    setBusy((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const post = useCallback(
    (item: QueueItem, decision: ReviewDecision, note: string | null, editedText: string | null) =>
      postJson<ReviewResult>(`/api/queue/${item.action_id}/review`, { decision, note, editedText }),
    [],
  );

  const review = useCallback(
    async (item: QueueItem, decision: ReviewDecision, note: string | null = null, editedText: string | null = null) => {
      mark([item.action_id], true);
      const outcome = await post(item, decision, note, editedText);
      mark([item.action_id], false);
      if (outcome.ok) {
        announce(announcement(item, decision, outcome));
        notifyChanged("review");
      }
      return outcome;
    },
    [mark, notifyChanged, post],
  );

  /** Approves several drafts one by one (reading reminders only); refreshes once at the end. */
  const approveMany = useCallback(
    async (items: QueueItem[]) => {
      const ids = items.map((i) => i.action_id);
      mark(ids, true);
      const failures: string[] = [];
      let fixtures = false;
      for (const item of items) {
        const outcome = await post(item, "APPROVED", null, null);
        fixtures ||= outcome.fixtures;
        if (!outcome.ok) failures.push(`${item.patient_id}: ${outcome.text}`);
      }
      mark(ids, false);
      const done = items.length - failures.length;
      const noun = done === 1 ? "reading reminder" : "reading reminders";
      announce(
        `${done} ${noun} approved${fixtures ? " · fixture mode, nothing was sent" : " · sent by SMS (simulated)"}` +
          (failures.length ? `. ${failures.length} not approved.` : ""),
      );
      notifyChanged("review");
      return failures;
    },
    [mark, notifyChanged, post],
  );

  /** Really posts the approval as Care agent; on refusal, logs it as REVIEW_DENIED. */
  const tryAsAgent = useCallback(
    async (item: QueueItem): Promise<AgentAttempt> => {
      mark([item.action_id], true);
      const outcome = await post(item, "APPROVED", null, null);
      if (outcome.ok) {
        mark([item.action_id], false);
        notifyChanged("review");
        return {
          refused: false,
          message: `Snowflake accepted this approval as Care agent. ${outcome.text} Check the role grants before the demo.`,
          code: null,
          logged: null,
        };
      }
      const refused = outcome.code === "SNOWFLAKE_REFUSED" || outcome.code === "ROLE_REFUSED";
      let logged: string | null = null;
      if (refused) {
        const denied = await postJson<ProcResult>(`/api/queue/${item.action_id}/denied`, {});
        logged = denied.ok ? denied.text || "Logged as REVIEW_DENIED in the audit log." : `The refusal was not logged: ${denied.text}`;
        announce(
          outcome.code === "ROLE_REFUSED"
            ? `The app's role check refused the approval for ${item.patient_id} as Care agent.`
            : `Snowflake refused the approval for ${item.patient_id} as Care agent.`,
        );
        if (denied.ok) notifyChanged("review-denied");
      }
      mark([item.action_id], false);
      return { refused, message: outcome.text, code: outcome.code, logged };
    },
    [mark, notifyChanged, post],
  );

  return { busy, review, approveMany, tryAsAgent };
}
