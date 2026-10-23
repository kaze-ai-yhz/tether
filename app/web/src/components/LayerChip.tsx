import { cx } from "./cx";
import styles from "./chips.module.css";

export type Layer = "P0" | "P1" | "P2";

/** Short form of a RULES citation: the part before the first colon, e.g. "GOLD 2026". */
export function shortCitation(citation: string | null | undefined): string | null {
  if (!citation) return null;
  const trimmed = citation.trim();
  if (trimmed.startsWith("PLACEHOLDER")) return "PLACEHOLDER · Faiz";
  const head = trimmed.split(":")[0].trim();
  return head.length > 28 ? `${head.slice(0, 27)}…` : head;
}

export interface LayerChipProps {
  layer: Layer | (string & {});
  /** Full citation; shown shortened, full text in the tooltip. */
  citation?: string | null;
  ruleId?: string | null;
  /** P1 only: the doctor whose pattern the rule came from. */
  doctor?: string | null;
  /** Adds a caution "pending confirmation" segment until Faiz confirms the rule. */
  pendingConfirmation?: boolean;
  size?: "sm" | "md";
  className?: string;
}

/**
 * Rule source layer: "P0 · GOLD 2026 · COPD-3" (neutral), "P1 · Dr. Example" (info),
 * "P2 · AI Plan" (Marker outline).
 */
export function LayerChip({
  layer,
  citation,
  ruleId,
  doctor,
  pendingConfirmation = false,
  size = "md",
  className,
}: LayerChipProps) {
  let parts: Array<string | null | undefined>;
  let tone: string;
  if (layer === "P2") {
    parts = ["P2", "AI Plan", ruleId];
    tone = styles.markerOutline;
  } else if (layer === "P1") {
    parts = ["P1", doctor, ruleId];
    tone = styles.info;
  } else {
    parts = [layer, shortCitation(citation), ruleId];
    tone = styles.neutral;
  }
  const text = parts.filter(Boolean).join(" · ");
  const chip = (
    <span className={cx(styles.chip, styles[size], tone)} title={citation ?? undefined} data-layer={layer}>
      {text}
    </span>
  );
  if (!pendingConfirmation) {
    return className ? <span className={className}>{chip}</span> : chip;
  }
  return (
    <span className={cx(styles.group, className)}>
      {chip}
      <span className="visually-hidden">, </span>
      <span className={cx(styles.chip, styles[size], styles.caution)}>pending confirmation</span>
    </span>
  );
}
