import { cx } from "./cx";
import styles from "./states.module.css";

export interface StepLoaderProps {
  /** Default "Recording…" (used for writes). Use e.g. "Loading queue…" for reads. */
  label?: string;
  className?: string;
}

/** Inline progress for a step in flight; announced politely to screen readers. */
export function StepLoader({ label = "Recording…", className }: StepLoaderProps) {
  return (
    <span className={cx(styles.loader, className)} role="status" aria-live="polite">
      <span className={styles.loaderTrack} aria-hidden="true">
        <span className={styles.loaderBar} />
      </span>
      <span>{label}</span>
    </span>
  );
}
