import { Icon, LayerChip, PlainTable, formatSimDate, tableCell } from "@/components";
import type { MonitoredValue } from "@/lib/types";
import { conditionLabel, overdueStep, plural, readingLabel } from "./format";
import styles from "./patients.module.css";

const METER_STEPS = [1, 2, 3, 4, 5] as const;

function Flag({ value }: { value: boolean }) {
  return value ? (
    <span className={styles.flag}>
      <Icon name="check" size={14} />
      Yes
    </span>
  ) : (
    <span className={`${styles.flag} ${styles.flagNo}`}>No</span>
  );
}

/** Days overdue with the overdue heat ramp; paused rows say why. */
function Overdue({ row }: { row: MonitoredValue }) {
  if (row.paused) return <span className={styles.paused}>Paused: no device</span>;
  const days = row.days_overdue;
  if (days === null) return <span className={styles.muted}>No schedule</span>;
  if (days > 0) {
    const step = overdueStep(days, row.rung);
    return (
      <span className={styles.overdue}>
        <span className={styles.meter} aria-hidden="true">
          {METER_STEPS.map((s) => (
            <span key={s} className={styles.meterSeg} data-step={s <= step ? s : undefined} />
          ))}
        </span>
        {plural(days, "day", "days")} overdue
      </span>
    );
  }
  if (days === 0) return <span>Due today</span>;
  return <span className={styles.muted}>Due in {plural(-days, "day", "days")}</span>;
}

/** Table 2: one row per monitored reading type, with the collect and action flags and the ladder rung. */
export function MonitoredTable({ rows }: { rows: MonitoredValue[] }) {
  if (rows.length === 0) {
    return <p className={styles.emptyLine}>No readings are monitored for this patient.</p>;
  }
  const conditions = new Set(rows.map((r) => r.condition));
  return (
    <PlainTable>
      <thead>
        <tr>
          <th scope="col">Reading</th>
          <th scope="col">Resource</th>
          <th scope="col">Cadence</th>
          <th scope="col">Last value</th>
          <th scope="col">Collect</th>
          <th scope="col">Action</th>
          <th scope="col">Overdue</th>
          <th scope="col">Rung</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${row.condition}-${row.reading_type}-${row.cadence_rule_id ?? "none"}`}>
            <td>
              {readingLabel(row.reading_type)}
              {conditions.size > 1 ? <span className={styles.subline}>{conditionLabel(row.condition)}</span> : null}
            </td>
            <td>
              {row.resource}
              {row.note ? <span className={styles.subline}>{row.note}</span> : null}
            </td>
            <td>
              {row.cadence_days !== null ? `Every ${plural(row.cadence_days, "day", "days")}` : <span className={styles.muted}>No cadence</span>}
              {row.cadence_rule_id || row.layer === "P2" ? (
                <span className={`${styles.subline} ${styles.layerCell}`}>
                  {row.cadence_rule_id ? <span className={styles.mono}>{row.cadence_rule_id}</span> : null}
                  {row.layer === "P2" ? <LayerChip layer="P2" size="sm" /> : null}
                </span>
              ) : null}
            </td>
            <td className="tabular">
              {row.last_value ?? <span className={styles.muted}>No reading yet</span>}
              {row.last_on ? <span className={styles.subline}>{formatSimDate(row.last_on)}</span> : null}
            </td>
            <td>
              <Flag value={row.collect_flag} />
            </td>
            <td>
              <Flag value={row.action_flag} />
            </td>
            <td>
              <Overdue row={row} />
            </td>
            <td className={tableCell.mono}>{row.rung ?? <span className={styles.muted}>None</span>}</td>
          </tr>
        ))}
      </tbody>
    </PlainTable>
  );
}
