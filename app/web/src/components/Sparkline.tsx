import { cx } from "./cx";
import styles from "./Sparkline.module.css";

export interface SparkPoint {
  /** Text label for the point, e.g. the reading date "2026-10-20". */
  label: string;
  value: number | null;
  /** Optional second series (e.g. diastolic BP), drawn in series.2. */
  value2?: number | null;
}

export interface SparklineProps {
  points: SparkPoint[];
  /** Accessible name, e.g. "SYN-006 resting SpO2, last 14 readings". */
  label: string;
  /** Threshold from the firing rule row (never typed by hand). Drawn dashed in status.alert. */
  threshold?: number | null;
  /** Text label for the threshold line, e.g. "COPD-3 ≤ 88 %". Charts label thresholds in text. */
  thresholdLabel?: string;
  /** Simulated readings draw dash-dot (DESIGN-SYSTEM §2.5). */
  simulated?: boolean;
  unit?: string;
  width?: number;
  height?: number;
  className?: string;
}

const PAD_X = 4;
const PAD_Y = 6;

function linePath(values: Array<number | null>, x: (i: number) => number, y: (v: number) => number): string {
  let d = "";
  let pen = false;
  values.forEach((v, i) => {
    if (v == null || Number.isNaN(v)) {
      pen = false;
      return;
    }
    d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    pen = true;
  });
  return d;
}

/** Inline SVG trend for recent readings with an optional dashed threshold line and text label. */
export function Sparkline({
  points,
  label,
  threshold,
  thresholdLabel,
  simulated = false,
  unit,
  width = 160,
  height = 40,
  className,
}: SparklineProps) {
  const v1 = points.map((p) => p.value);
  const v2 = points.map((p) => p.value2 ?? null);
  const hasSecond = v2.some((v) => v != null);
  const all = [...v1, ...(hasSecond ? v2 : []), ...(threshold != null ? [threshold] : [])].filter(
    (v): v is number => v != null && !Number.isNaN(v),
  );
  const last = [...points].reverse().find((p) => p.value != null);
  const summary = last
    ? `${label}. ${points.length} readings, latest ${last.value}${last.value2 != null ? `/${last.value2}` : ""}${unit ? ` ${unit}` : ""} on ${last.label}.`
    : `${label}. No readings.`;
  const fullLabel = threshold != null && thresholdLabel ? `${summary} Threshold ${thresholdLabel}.` : summary;

  if (all.length === 0) {
    return (
      <span className={cx(styles.wrap, className)} role="img" aria-label={fullLabel}>
        <span className={styles.none}>No readings</span>
      </span>
    );
  }

  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const innerW = width - PAD_X * 2;
  const innerH = height - PAD_Y * 2;
  const x = (i: number) => PAD_X + (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => PAD_Y + innerH - ((v - min) / span) * innerH;
  const dash = simulated ? "6 3 1 3" : undefined;
  const lastIndex = v1.lastIndexOf(last?.value ?? null);

  return (
    <span className={cx(styles.wrap, className)}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={fullLabel}
        className={styles.svg}
      >
        <title>{fullLabel}</title>
        {threshold != null ? (
          <line
            x1={PAD_X}
            x2={width - PAD_X}
            y1={y(threshold)}
            y2={y(threshold)}
            className={styles.threshold}
            strokeDasharray="4 3"
          />
        ) : null}
        {hasSecond ? (
          <path d={linePath(v2, x, y)} className={styles.series2} strokeDasharray={dash} />
        ) : null}
        <path d={linePath(v1, x, y)} className={styles.series1} strokeDasharray={dash} />
        {last && lastIndex >= 0 ? <circle cx={x(lastIndex)} cy={y(last.value as number)} r={2.2} className={styles.dot} /> : null}
      </svg>
      {threshold != null && thresholdLabel ? (
        <span className={styles.thresholdLabel} aria-hidden="true">
          {thresholdLabel}
        </span>
      ) : null}
    </span>
  );
}
