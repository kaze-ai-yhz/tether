import type { ReactNode } from "react";
import { cx } from "./cx";
import styles from "./states.module.css";

export interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  /** Optional call to action, e.g. a <Button>. */
  action?: ReactNode;
  className?: string;
}

/** Calm empty view: what is missing and, if useful, the next step. */
export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <section className={cx(styles.empty, className)}>
      <h2 className={styles.emptyTitle}>{title}</h2>
      {description ? <div className={styles.emptyBody}>{description}</div> : null}
      {action ? <div className={styles.emptyAction}>{action}</div> : null}
    </section>
  );
}
