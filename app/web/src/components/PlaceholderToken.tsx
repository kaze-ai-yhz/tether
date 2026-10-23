import { cx } from "./cx";
import styles from "./chips.module.css";

export interface PlaceholderTokenProps {
  /** Defaults to "PLACEHOLDER · Faiz". */
  label?: string;
  /** Tooltip text explaining what is unconfirmed. */
  title?: string;
  className?: string;
}

/** Inline marker for a clinical value that Dr. Faiz has not confirmed yet. */
export function PlaceholderToken({
  label = "PLACEHOLDER · Faiz",
  title = "Clinical value pending confirmation by Dr. Faiz",
  className,
}: PlaceholderTokenProps) {
  return (
    <span className={cx(styles.chip, styles.sm, styles.caution, styles.mono, className)} title={title}>
      {label}
    </span>
  );
}
