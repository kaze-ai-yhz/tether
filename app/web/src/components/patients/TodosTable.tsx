import { Icon, LayerChip, PlainTable, formatSimDate, tableCell } from "@/components";
import type { PatientDetail, RuleRow, Todo } from "@/lib/types";
import { TODO_KIND_LABEL, sentenceCase } from "./format";
import { ToneChip } from "./ToneChip";
import styles from "./patients.module.css";

export type CitationLookup = Record<string, Pick<RuleRow, "citation" | "step">>;

/** Done = solid (recorded); a due date not yet reached = dashed 4/3 plate (scheduled). */
function Due({ todo }: { todo: Todo }) {
  if (todo.done) return <ToneChip tone="ok" icon="check" label="Done" />;
  if (!todo.due_on) return <span className={styles.muted}>Ongoing</span>;
  return (
    <span className={styles.due}>
      <svg className={styles.dueEdge} aria-hidden="true" focusable="false">
        <rect x="0.5" y="0.5" rx="2" />
      </svg>
      <span className="visually-hidden">Scheduled for </span>
      {formatSimDate(todo.due_on) ?? todo.due_on}
    </span>
  );
}

/** P0 = "P0 · <citation> · <rule>"; P2 = "P2 · AI Plan · <signed note>" plus the setting or rule it carries. */
function Source({ todo, patient, citations }: { todo: Todo; patient: PatientDetail; citations: CitationLookup }) {
  if (todo.layer === "P2") {
    const fromSetting = todo.setting ? patient.active_overrides.find((o) => o.setting === todo.setting)?.note_id : undefined;
    const fromFiring = todo.rule_id ? patient.firings.find((f) => f.rule_id === todo.rule_id)?.override_note_id : undefined;
    const noteId = fromSetting ?? fromFiring ?? patient.plan?.note_id ?? null;
    const carries = todo.setting ?? todo.rule_id;
    return (
      <span className={styles.layerCell}>
        <LayerChip layer="P2" ruleId={noteId} size="sm" />
        {carries ? <span className={styles.mono}>{carries}</span> : null}
      </span>
    );
  }
  const rule = todo.rule_id ? citations[todo.rule_id] : undefined;
  return <LayerChip layer={todo.layer} citation={rule?.citation ?? null} ruleId={todo.rule_id} size="sm" />;
}

export interface TodosTableProps {
  patient: PatientDetail;
  citations: CitationLookup;
}

/** Table 1: the plan's todos in order, each traced to a RULES row (P0) or a signed AI Plan line (P2). */
export function TodosTable({ patient, citations }: TodosTableProps) {
  const todos = [...patient.todos].sort((a, b) => a.seq - b.seq);
  const reasons = patient.plan?.validation?.ok === false ? (patient.plan.validation.reasons ?? []) : [];
  return (
    <>
      {reasons.length ? (
        <p className={styles.cardLine}>
          <Icon name="triangle" size={14} /> The plan check found: {reasons.join("; ")}
        </p>
      ) : null}
      {todos.length === 0 ? (
        <p className={styles.emptyLine}>No todos yet. Todos are composed from RULES and the applied AI Plan lines.</p>
      ) : (
        <PlainTable>
          <thead>
            <tr>
              <th scope="col" className={tableCell.numeric}>
                #
              </th>
              <th scope="col">Todo</th>
              <th scope="col">Due</th>
              <th scope="col">Source</th>
              <th scope="col">Kind</th>
            </tr>
          </thead>
          <tbody>
            {todos.map((todo) => (
              <tr key={todo.todo_id}>
                <td className={tableCell.numeric}>{todo.seq}</td>
                <td>{todo.todo_text}</td>
                <td>
                  <Due todo={todo} />
                </td>
                <td>
                  <Source todo={todo} patient={patient} citations={citations} />
                </td>
                <td>{(TODO_KIND_LABEL as Record<string, string>)[todo.kind] ?? sentenceCase(todo.kind)}</td>
              </tr>
            ))}
          </tbody>
        </PlainTable>
      )}
    </>
  );
}
