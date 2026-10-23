import { cx } from "./cx";
import styles from "./chips.module.css";

export interface SimulatedTagProps {
  /** Defaults to "Simulated". */
  label?: string;
  size?: "sm" | "md";
  className?: string;
}

/** Marks simulated data (clock, calls, adapters): neutral outline with a dash-dot edge. */
export function SimulatedTag({ label = "Simulated", size = "sm", className }: SimulatedTagProps) {
  return (
    <span className={cx(styles.chip, styles[size], styles.simulated, className)}>
      <svg className={styles.simulatedEdge} aria-hidden="true" focusable="false">
        <rect x="0.5" y="0.5" rx="2" />
      </svg>
      <span>{label}</span>
    </span>
  );
}
