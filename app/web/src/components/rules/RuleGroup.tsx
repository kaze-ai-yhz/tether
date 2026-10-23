"use client";

import { Fragment } from "react";
import type { RuleRow } from "@/lib/types";
import { Button } from "../Button";
import { cx } from "../cx";
import { Icon } from "../icons";
import { LayerChip } from "../LayerChip";
import { PlaceholderToken } from "../PlaceholderToken";
import { ClinicianOnlyButton } from "./ClinicianOnlyButton";
import type { SavedEdit } from "./EditRuleDialog";
import { Arrow, ImpactSummary } from "./ImpactSummary";
import {
  FIELD_LABEL,
  citationDetail,
  editableFields,
  firesPhrase,
  formatValue,
  isPlaceholderRule,
  recipientPhrase,
  toNumber,
  type RuleGroupData,
} from "./rules-format";
import styles from "./rules.module.css";

export const EDIT_DENIED = "Only a clinician can change a rule. Switch Acting as to Clinician.";

/** Columns in a group table (the saved-edit row spans all of them). */
const COLUMNS = 7;

function Dash({ label = "none" }: { label?: string }) {
  return (
    <>
      <span className={styles.none} aria-hidden="true">
        —
      </span>
      <span className="visually-hidden">{label}</span>
    </>
  );
}

function NumberCell({ value }: { value: unknown }) {
  const text = formatValue(value);
  return <td className={styles.num}>{text ?? <Dash />}</td>;
}

/** Mono action type that may wrap after an underscore (RECOMMEND_O2_EVAL). */
function ActionType({ value }: { value: string }) {
  const parts = String(value ?? "").split("_");
  return (
    <span className={styles.actionType}>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 ? (
            <>
              _<wbr />
            </>
          ) : null}
          {part}
        </Fragment>
      ))}
    </span>
  );
}

/** Citation as a P0 LayerChip (source) plus its text; PLACEHOLDER citations get the token instead. */
function Citation({ rule }: { rule: RuleRow }) {
  const citation = (rule.citation ?? "").trim();
  const detail = citationDetail(citation);
  if (isPlaceholderRule(rule)) {
    const rest = detail ?? (citation.replace(/^PLACEHOLDER\s*(·\s*Faiz)?\s*/i, "") || null);
    return (
      <span className={styles.citationLine}>
        <PlaceholderToken title={citation || undefined} />
        {rest ? <> {rest}</> : null}
      </span>
    );
  }
  if (!citation) return null;
  return (
    <span className={styles.citationLine}>
      <LayerChip layer="P0" citation={detail ? citation : null} size="sm" /> {detail ?? citation}
    </span>
  );
}

interface RuleTableRowProps {
  rule: RuleRow;
  canEdit: boolean;
  onEdit: (rule: RuleRow) => void;
}

function RuleTableRow({ rule, canEdit, onEdit }: RuleTableRowProps) {
  const count = toNumber(rule.firing_count);
  const editable = editableFields(rule).length > 0;
  return (
    <tr>
      <th scope="row">
        <span className={styles.ruleId}>{rule.rule_id}</span>
        <span className={styles.meta}>priority {formatValue(rule.priority) ?? "—"}</span>
        {count === null ? null : (
          <span className={styles.firing} data-count={count}>
            {firesPhrase(count)}
          </span>
        )}
      </th>
      <td>
        <span className={styles.stepLine}>
          <span>{rule.step}</span>
          {rule.is_red_flag ? (
            <span className={styles.floor}>
              <Icon name="triangle" size={12} />
              Floor: cannot be loosened
            </span>
          ) : null}
        </span>
        <span className={styles.actionLine}>
          <ActionType value={rule.action_type} /> · {recipientPhrase(rule.recipient)}
        </span>
        <Citation rule={rule} />
      </td>
      <NumberCell value={rule.threshold1} />
      <NumberCell value={rule.threshold2} />
      <NumberCell value={rule.window_days} />
      <NumberCell value={rule.min_readings} />
      <td className={styles.editCell}>
        {editable ? (
          <ClinicianOnlyButton
            allowed={canEdit}
            deniedReason={EDIT_DENIED}
            onPress={() => onEdit(rule)}
            aria-label={`Edit threshold for ${rule.rule_id}`}
          >
            Edit threshold
          </ClinicianOnlyButton>
        ) : (
          <Dash label="No editable threshold" />
        )}
      </td>
    </tr>
  );
}

interface ResultRowProps {
  saved: SavedEdit;
  canEdit: boolean;
  onRevert: (saved: SavedEdit) => void;
  onDismiss: () => void;
}

/** What the last save returned, right under the edited rule, with the revert offer. */
function ResultRow({ saved, canEdit, onRevert, onDismiss }: ResultRowProps) {
  const canRevert = !saved.fixtures && toNumber(saved.oldValue) !== null;
  return (
    <tr className={styles.resultRow}>
      <td colSpan={COLUMNS}>
        <div className={styles.result} data-fixtures={saved.fixtures}>
          <p className={styles.resultHead}>
            <Icon name={saved.fixtures ? "info" : "circleCheck"} />
            {saved.fixtures ? (
              <span>Fixture mode: {saved.ruleId} was not changed</span>
            ) : (
              <span>
                Saved · {saved.ruleId} {FIELD_LABEL[saved.field]} {saved.oldValue ?? "—"}
                <Arrow />
                {saved.newValue ?? "—"}
              </span>
            )}
          </p>
          {saved.impact ? <ImpactSummary impact={saved.impact} tense="saved" /> : null}
          {saved.message ? <p className={styles.procMessage}>{saved.message}</p> : null}
          <div className={styles.resultActions}>
            {canRevert ? (
              <ClinicianOnlyButton allowed={canEdit} deniedReason={EDIT_DENIED} onPress={() => onRevert(saved)}>
                Revert to {saved.oldValue}
              </ClinicianOnlyButton>
            ) : null}
            <Button variant="tertiary" size="sm" onPress={onDismiss}>
              Dismiss
            </Button>
          </div>
        </div>
      </td>
    </tr>
  );
}

export interface RuleGroupProps {
  group: RuleGroupData;
  canEdit: boolean;
  lastEdit: SavedEdit | null;
  onEdit: (rule: RuleRow) => void;
  onRevert: (saved: SavedEdit) => void;
  onDismissResult: () => void;
}

/** One condition's RULES rows, ordered by priority. */
export function RuleGroup({ group, canEdit, lastEdit, onEdit, onRevert, onDismissResult }: RuleGroupProps) {
  const titleId = `${group.anchor}-title`;
  return (
    <section id={group.anchor} aria-labelledby={titleId} className={styles.group}>
      <div className={styles.groupHead}>
        <h3 id={titleId}>{group.label}</h3>
        <span className={styles.groupCount}>
          {group.rules.length} {group.rules.length === 1 ? "rule" : "rules"}
        </span>
      </div>
      <div className={styles.tableScroll}>
        <table className={cx(styles.table, styles.rulesTable)}>
          <caption className="visually-hidden">{group.label} rules, ordered by priority</caption>
          <colgroup>
            <col className={styles.colRule} />
            <col />
            <col className={styles.colNum} />
            <col className={styles.colNum} />
            <col className={styles.colNum} />
            <col className={styles.colNum} />
            <col className={styles.colEdit} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Rule</th>
              <th scope="col">Step, action, citation</th>
              <th scope="col" className={styles.num}>
                Threshold 1
              </th>
              <th scope="col" className={styles.num}>
                Threshold 2
              </th>
              <th scope="col" className={styles.num}>
                Window (days)
              </th>
              <th scope="col" className={styles.num}>
                Min readings
              </th>
              <th scope="col">
                <span className="visually-hidden">Edit</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {group.rules.map((rule) => (
              <Fragment key={rule.rule_id}>
                <RuleTableRow rule={rule} canEdit={canEdit} onEdit={onEdit} />
                {lastEdit && lastEdit.ruleId === rule.rule_id ? (
                  <ResultRow saved={lastEdit} canEdit={canEdit} onRevert={onRevert} onDismiss={onDismissResult} />
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
