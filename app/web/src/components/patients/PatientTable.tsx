"use client";

import { useMemo, useState } from "react";
import type { SortDescriptor } from "react-aria-components";
import {
  DataCell,
  DataColumn,
  DataRow,
  DataTable,
  DataTableBody,
  DataTableHeader,
  DataTableScroll,
  StatusChip,
  formatSimDate,
} from "@/components";
import type { PatientListRow } from "@/lib/types";
import { conditionLabel } from "./format";
import { ToneChip } from "./ToneChip";
import styles from "./patients.module.css";

type SortKey = "patient" | "conditions" | "plan" | "todos" | "step" | "status" | "next";

function sortValue(row: PatientListRow, key: SortKey): string | number | null {
  switch (key) {
    case "patient":
      return row.patient_id;
    case "conditions":
      return row.conditions.join(" ");
    case "plan":
      return row.ai_plan_mode === null ? null : `${row.ai_plan_mode} ${row.plan_status === "NEEDS_REVIEW" ? 0 : 1}`;
    case "todos":
      return row.todos_total > 0 ? row.todos_done / row.todos_total : null;
    case "step":
      return row.current_rule_id ?? row.rung;
    case "status":
      return row.status_rank;
    case "next":
      return row.next_visit_on;
  }
}

/** Sorts by the chosen column (empty values last), then by status rank and SYN id. */
function sortRows(rows: PatientListRow[], descriptor: SortDescriptor): PatientListRow[] {
  const key = descriptor.column as SortKey;
  const direction = descriptor.direction === "descending" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    if (va === null && vb !== null) return 1;
    if (vb === null && va !== null) return -1;
    if (va !== null && vb !== null && va !== vb) {
      const order = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      if (order !== 0) return order * direction;
    }
    return a.status_rank - b.status_rank || a.patient_id.localeCompare(b.patient_id);
  });
}

function None({ label = "None" }: { label?: string }) {
  return (
    <>
      <span className={styles.dash} aria-hidden="true">
        —
      </span>
      <span className="visually-hidden">{label}</span>
    </>
  );
}

export interface PatientTableProps {
  rows: PatientListRow[];
  /** Height limit so the header sticks; depends on whether the fixture banner is showing. */
  maxHeight: string;
}

/** Patients list: sticky header, arrow-key row navigation, sortable columns; a row opens the patient. */
export function PatientTable({ rows, maxHeight }: PatientTableProps) {
  const [sort, setSort] = useState<SortDescriptor>({ column: "status", direction: "ascending" });
  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort]);

  return (
    <DataTableScroll maxHeight={maxHeight} className={styles.listScroll}>
      <DataTable
        aria-label="Patients"
        className={styles.listTable}
        sortDescriptor={sort}
        onSortChange={setSort}
      >
        <DataTableHeader>
          <DataColumn id="patient" isRowHeader allowsSorting className={styles.colPatient}>
            Patient
          </DataColumn>
          <DataColumn id="conditions" allowsSorting className={styles.colConditions}>
            Conditions
          </DataColumn>
          <DataColumn id="plan" allowsSorting className={styles.colPlan}>
            AI Plan
          </DataColumn>
          <DataColumn id="todos" allowsSorting numeric className={styles.colTodos}>
            Todos
          </DataColumn>
          <DataColumn id="step" allowsSorting className={styles.colStep}>
            Current step
          </DataColumn>
          <DataColumn id="status" allowsSorting>
            Status
          </DataColumn>
          <DataColumn id="next" allowsSorting className={styles.colNext}>
            Next visit
          </DataColumn>
        </DataTableHeader>
        <DataTableBody items={sorted} renderEmptyState={() => <div className={styles.muted}>No patients in the record.</div>}>
          {(row) => (
            <DataRow
              id={row.patient_id}
              href={`/patients/${row.patient_id}`}
              textValue={`${row.display_name} ${row.patient_id}`}
            >
              <DataCell>
                <span className={styles.cellLine}>
                  <span className={styles.patientName}>{row.display_name}</span>
                  <span className={styles.patientId}>{row.patient_id}</span>
                </span>
              </DataCell>
              <DataCell>
                <span title={row.conditions.map(conditionLabel).join(", ")}>
                  {row.conditions.length ? row.conditions.join(" · ") : <None />}
                </span>
              </DataCell>
              <DataCell>
                <span className={styles.cellLine}>
                  <span>{row.ai_plan_mode ?? <None label="No AI Plan" />}</span>
                  {row.plan_status === "NEEDS_REVIEW" ? (
                    <ToneChip tone="caution" icon="eye" label="Needs review" />
                  ) : null}
                </span>
              </DataCell>
              <DataCell numeric>
                <span aria-label={`${row.todos_done} of ${row.todos_total} done`}>
                  {row.todos_done}/{row.todos_total}
                </span>
              </DataCell>
              <DataCell mono>
                {row.current_rule_id ?? row.rung ? (
                  <span title={row.current_step ?? undefined}>{row.current_rule_id ?? row.rung}</span>
                ) : (
                  <None label="No rule firing" />
                )}
              </DataCell>
              <DataCell>
                <span className={styles.cellLine}>
                  <StatusChip status={row.display_status} size="sm" />
                  {row.status_reason ? (
                    <span className={styles.reason} title={row.status_reason}>
                      {row.status_reason}
                    </span>
                  ) : null}
                </span>
              </DataCell>
              <DataCell>{formatSimDate(row.next_visit_on) ?? <None label="Not scheduled" />}</DataCell>
            </DataRow>
          )}
        </DataTableBody>
      </DataTable>
    </DataTableScroll>
  );
}
