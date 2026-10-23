"use client";

import { useState } from "react";
import { Button } from "../Button";
import { ConfirmDialog } from "../ConfirmDialog";
import { SimulatedTag } from "../SimulatedTag";
import { StepLoader } from "../StepLoader";
import { formatSimDate } from "../format";
import { announce } from "./events";
import { postJson, type ApiOutcome } from "./request";
import { useShell } from "./ShellContext";
import styles from "./shell.module.css";

/** Day steps for POST /api/clock; 0 = jump to the next ladder event. */
const DAY_STEPS = [1, 2, 5, 10, 21] as const;

interface LastResult {
  action: string;
  outcome: ApiOutcome;
}

/** Extra note for fixture responses whose message does not already say so. */
function fixtureNote(outcome: ApiOutcome): string {
  return outcome.fixtures && !/fixture/i.test(outcome.text) ? " Fixture mode: nothing changed in Snowflake." : "";
}

/** Right-hand demo panel: simulated clock steps and demo reset. Labelled as demo-only. */
export function DemoPanel() {
  const { appState, notifyChanged } = useShell();
  const [collapsed, setCollapsed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [last, setLast] = useState<LastResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const asOf = formatSimDate(appState?.as_of_date ?? null);

  async function run(action: string, url: string, payload: unknown, reason: string): Promise<ApiOutcome> {
    setBusy(action);
    const outcome = await postJson(url, payload);
    setBusy(null);
    setLast({ action, outcome });
    announce(outcome.ok ? `${action}: ${outcome.text}${fixtureNote(outcome)}` : `${action} did not complete. ${outcome.text}`);
    if (outcome.ok) notifyChanged(reason);
    return outcome;
  }

  function advance(days: number) {
    const action = days === 0 ? "Next event" : `Advance clock +${days} d`;
    void run(action, "/api/clock", { days }, "clock");
  }

  async function reset(): Promise<boolean> {
    const outcome = await run("Reset demo", "/api/demo/reset", {}, "reset");
    if (!outcome.ok) throw new Error(outcome.text);
    return true;
  }

  if (collapsed) {
    return (
      <aside className={styles.demo} data-collapsed="true" aria-label="Demo controls">
        <div className={styles.demoHead}>
          <Button
            variant="tertiary"
            size="sm"
            iconOnly
            icon="chevronLeft"
            aria-label="Show demo controls"
            aria-expanded={false}
            onPress={() => setCollapsed(false)}
          />
          <span className={styles.demoVertical} aria-hidden="true">
            Demo controls
          </span>
        </div>
      </aside>
    );
  }

  return (
    <aside className={styles.demo} data-collapsed="false" aria-labelledby="demo-controls-title">
      <div className={styles.demoHead}>
        <h2 className={styles.demoTitle} id="demo-controls-title">
          Demo controls <SimulatedTag />
        </h2>
        <Button
          variant="tertiary"
          size="sm"
          iconOnly
          icon="chevronRight"
          aria-label="Hide demo controls"
          aria-expanded
          onPress={() => setCollapsed(true)}
        />
      </div>

      <div className={styles.demoBody}>
        <section className={styles.demoSection} aria-labelledby="demo-clock-title">
          <h3 className={styles.demoSectionTitle} id="demo-clock-title">
            Simulated clock
          </h3>
          <p className={styles.demoNow}>
            As of {asOf ?? "…"} <span className={styles.clockSim}>(simulated)</span>
          </p>
          <div className={styles.dayGrid} role="group" aria-label="Advance the simulated clock">
            {DAY_STEPS.map((days) => (
              <Button key={days} size="sm" isDisabled={busy !== null} onPress={() => advance(days)}>
                {`+${days} d`}
              </Button>
            ))}
            <Button size="sm" isDisabled={busy !== null} onPress={() => advance(0)}>
              Next event
            </Button>
          </div>
          <p className={styles.demoHint}>
            Moves the simulated date and re-runs the rules. New drafts wait in the queue for a clinician.
          </p>
        </section>

        <section className={styles.demoSection} aria-labelledby="demo-reset-title">
          <h3 className={styles.demoSectionTitle} id="demo-reset-title">
            Reset
          </h3>
          <div>
            <Button variant="destructive" size="sm" icon="reset" isDisabled={busy !== null} onPress={() => setConfirmOpen(true)}>
              Reset demo
            </Button>
          </div>
          <p className={styles.demoHint}>Restores the demo tables from the saved snapshot. No model calls.</p>
        </section>

        {busy ? <StepLoader /> : null}

        {last ? (
          <div className={styles.statusLine} data-tone={last.outcome.ok ? "ok" : "error"}>
            <span>
              {last.outcome.ok ? `${last.action}: ` : `${last.action} did not complete. `}
              {last.outcome.text}
            </span>
            {fixtureNote(last.outcome) ? (
              <span className={styles.statusMeta}>Fixture mode: nothing changed in Snowflake.</span>
            ) : null}
            {last.outcome.code ? <span className={styles.statusMeta}>{last.outcome.code}</span> : null}
            <details className={styles.details}>
              <summary>Details</summary>
              <pre>{JSON.stringify(last.outcome.raw, null, 2)}</pre>
            </details>
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        isOpen={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Reset the demo?"
        confirmLabel="Reset demo"
        destructive
        onConfirm={reset}
      >
        Every demo table, including the audit log, goes back to the saved snapshot. Approvals, sends and clock moves
        made since then are discarded.
      </ConfirmDialog>
    </aside>
  );
}
