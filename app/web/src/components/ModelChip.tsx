import { cx } from "./cx";
import styles from "./chips.module.css";

export interface ModelChipProps {
  /** The row's model id (e.g. MODEL_CALLS.model / ACTION_META.model). Never hard-code it. */
  model?: string | null;
  /** Verb for the machine work: "Drafted", "Read", "Composed", "Extracted", "Classified". */
  action?: string;
  /** ACTION_META.draft_source. TEMPLATE and RULE are not model output, so they render neutral. */
  source?: "CLAUDE" | "TEMPLATE" | "RULE" | (string & {}) | null;
  size?: "sm" | "md";
  className?: string;
}

function vendorOf(model: string): string {
  return /claude/i.test(model) ? "Claude" : "Cortex";
}

/** AI provenance chip in Marker: "Drafted by Claude · claude-sonnet-5-5". */
export function ModelChip({ model, action = "Drafted", source, size = "md", className }: ModelChipProps) {
  if (source === "TEMPLATE" || source === "RULE") {
    const text = source === "TEMPLATE" ? "Template text · no model output" : "Deterministic text · no model";
    return <span className={cx(styles.chip, styles[size], styles.neutral, className)}>{text}</span>;
  }
  const text = model ? `${action} by ${vendorOf(model)} · ${model}` : `${action} by a model · id not recorded`;
  return (
    <span className={cx(styles.chip, styles[size], styles.marker, className)} data-model={model ?? undefined}>
      <span className={styles.markerGlyph} aria-hidden="true" />
      <span>{text}</span>
    </span>
  );
}
