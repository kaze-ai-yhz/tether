import { Suspense } from "react";
import { ErrorState, StepLoader } from "@/components";
import { QueueView } from "@/components/queue/QueueView";
import { getQueue, getRules, getState } from "@/lib/data";
import { getActingAs } from "@/lib/session";
import type { RuleRow } from "@/lib/types";

// Approval queue: PENDING drafts from V_QUEUE (red flags pinned), clinician holds from V_HELD,
// counts from V_APP_STATE. Reads run per request as the acting role.
export default function QueuePage() {
  return (
    <Suspense fallback={<StepLoader label="Loading the queue…" />}>
      <QueueContent />
    </Suspense>
  );
}

async function QueueContent() {
  const actingAs = await getActingAs();
  const [state, queue, rules] = await Promise.all([getState(actingAs), getQueue(actingAs), getRules(actingAs)]);

  if (!queue.ok) {
    return (
      <>
        <header className="page-header">
          <h1>Approval queue</h1>
        </header>
        <ErrorState title="Could not load the queue" message={queue.error.message} code={queue.error.code} />
      </>
    );
  }

  // Sparkline reference lines come from RULES rows; without them the charts simply omit the line.
  const thresholds: Record<string, Pick<RuleRow, "threshold1">> = {};
  if (rules.ok) {
    for (const rule of rules.data.rules) thresholds[rule.rule_id] = { threshold1: rule.threshold1 };
  }

  return (
    <QueueView
      state={state.ok ? state.data : null}
      items={queue.data.items}
      held={queue.data.held}
      thresholds={thresholds}
    />
  );
}
