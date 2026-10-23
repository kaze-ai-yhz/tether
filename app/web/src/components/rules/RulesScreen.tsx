"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { DataResult, RuleRow, RulesBundle } from "@/lib/types";
import { cx } from "../cx";
import { EmptyState } from "../EmptyState";
import { ErrorState } from "../ErrorState";
import { Icon } from "../icons";
import { announce } from "../shell/events";
import { useOnTetherChanged, useShell } from "../shell/ShellContext";
import { StepLoader } from "../StepLoader";
import { AiPlanKeysCard } from "./AiPlanKeysCard";
import { EditHistory } from "./EditHistory";
import { EditRuleDialog, type EditPrefill, type SavedEdit } from "./EditRuleDialog";
import { RuleGroup } from "./RuleGroup";
import { FIELD_LABEL, groupRules, patientsChangePhrase } from "./rules-format";
import styles from "./rules.module.css";

interface EditingState {
  ruleId: string;
  prefill: EditPrefill | null;
  open: boolean;
  /** New per opening, so the form starts fresh; kept while closing so the exit animation has content. */
  seq: number;
}

function RulesHeader({ aside }: { aside?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>Rules</h1>
        <p>
          Dr. Faiz&apos;s guideline rules from RULES, grouped by condition and ordered by priority. Thresholds are
          rows: a clinician changes one with a reason and sees which patients&apos; firings change.
        </p>
      </div>
      {aside ? <div className={styles.headerAside}>{aside}</div> : null}
    </header>
  );
}

function savedAnnouncement(saved: SavedEdit): string {
  if (saved.fixtures) return `Fixture mode: ${saved.ruleId} was not changed.`;
  const change = `${saved.ruleId} ${FIELD_LABEL[saved.field]} changed from ${saved.oldValue ?? "no value"} to ${
    saved.newValue ?? "no value"
  }.`;
  return saved.impact ? `${change} V_RULE_FIRINGS: ${patientsChangePhrase(saved.impact.count, "saved")}.` : change;
}

export interface RulesScreenProps {
  /** GET /api/rules bundle, read on the server as the acting role. */
  result: DataResult<RulesBundle>;
}

/** Rules tab: RULES by condition, clinician-only threshold edit, edit history, AI Plan keys. */
export function RulesScreen({ result }: RulesScreenProps) {
  const router = useRouter();
  const { actingAs, notifyChanged } = useShell();
  const [refreshing, startRefresh] = useTransition();
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [lastEdit, setLastEdit] = useState<SavedEdit | null>(null);

  // A demo reset restores RULES, so the last save and its revert offer no longer apply.
  useOnTetherChanged((detail) => {
    if (detail.reason === "reset") setLastEdit(null);
  });

  const canEdit = actingAs === "clinician";

  if (!result.ok) {
    return (
      <div className={styles.screen}>
        <RulesHeader />
        <ErrorState
          title="Could not load the rules"
          message={result.error.message}
          code={result.error.code}
          onRetry={() => startRefresh(() => router.refresh())}
          retryLabel={refreshing ? "Retrying…" : "Try again"}
        />
      </div>
    );
  }

  const { rules, edits, override_keys: keys, safety_locked_terms: terms } = result.data;
  const groups = groupRules(rules);
  const editingRule = editing ? (rules.find((r) => r.rule_id === editing.ruleId) ?? null) : null;

  function openEdit(rule: RuleRow, prefill: EditPrefill | null) {
    setEditing((prev) => ({ ruleId: rule.rule_id, prefill, open: true, seq: (prev?.seq ?? 0) + 1 }));
  }

  function revert(saved: SavedEdit) {
    const rule = rules.find((r) => r.rule_id === saved.ruleId);
    if (rule && saved.oldValue !== null) openEdit(rule, { field: saved.field, value: saved.oldValue });
  }

  function closeEdit() {
    setEditing((prev) => (prev ? { ...prev, open: false } : prev));
  }

  function saved(edit: SavedEdit) {
    setLastEdit(edit);
    announce(savedAnnouncement(edit));
    // Fixture mode changed nothing, so there is nothing to re-read.
    if (!edit.fixtures) startRefresh(() => notifyChanged("rule-edit"));
  }

  const source = result.fixtures
    ? result.fixture_source === "sample"
      ? "Sample data, not from Snowflake"
      : `Fixture rows from ${result.fixture_source ?? "an export"}`
    : null;

  return (
    <div className={styles.screen}>
      <RulesHeader
        aside={
          source || refreshing ? (
            <>
              {source ? <span className={styles.sourceNote}>{source}</span> : null}
              {refreshing ? <StepLoader label="Refreshing rules…" /> : null}
            </>
          ) : null
        }
      />

      <section aria-labelledby="rules-guideline-title" className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 id="rules-guideline-title">Guideline rules</h2>
          <span className={styles.groupCount}>
            {rules.length} {rules.length === 1 ? "rule" : "rules"} in RULES
          </span>
        </div>
        <div className={styles.notes}>
          <p className={cx(styles.note, styles.caution)}>
            <Icon name="eye" size={14} />
            Thresholds pending clinician confirmation against the full guideline text
          </p>
          {canEdit ? null : (
            <p className={cx(styles.note, styles.neutral)}>
              <Icon name="info" size={14} />
              Acting as Care agent: rules are read-only. Only a clinician can change a threshold.
            </p>
          )}
        </div>
        {groups.length > 0 ? (
          <>
            <nav aria-label="Rule groups" className={styles.jump}>
              <ul>
                {groups.map((group) => (
                  <li key={group.condition}>
                    <a href={`#${group.anchor}`}>
                      {group.label}
                      <span className={styles.jumpCount}>{group.rules.length}</span>
                    </a>
                  </li>
                ))}
                <li>
                  <a href="#rules-history">
                    Edit history<span className={styles.jumpCount}>{edits.length}</span>
                  </a>
                </li>
                <li>
                  <a href="#rules-ai-plan-keys">
                    AI Plan keys<span className={styles.jumpCount}>{keys.length}</span>
                  </a>
                </li>
              </ul>
            </nav>
            <div className={styles.groups}>
              {groups.map((group) => (
                <RuleGroup
                  key={group.condition}
                  group={group}
                  canEdit={canEdit}
                  lastEdit={lastEdit}
                  onEdit={(rule) => openEdit(rule, null)}
                  onRevert={revert}
                  onDismissResult={() => setLastEdit(null)}
                />
              ))}
            </div>
          </>
        ) : (
          <EmptyState title="No rules" description="V_RULES returned no rows." />
        )}
      </section>

      <EditHistory edits={edits} />

      <AiPlanKeysCard keys={keys} terms={terms} />

      <EditRuleDialog
        key={editing?.seq ?? 0}
        rule={editingRule}
        prefill={editing?.prefill ?? null}
        isOpen={editing?.open === true}
        onClose={closeEdit}
        onSaved={saved}
      />
    </div>
  );
}
