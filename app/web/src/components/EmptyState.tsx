import type { ReactNode } from "react";
import { Illustration } from "./art/Illustration";
import type { IllustrationName } from "./art/assets";
import { cx } from "./cx";
import styles from "./states.module.css";

export interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  /** Optional call to action, e.g. a <Button>. */
  action?: ReactNode;
  /** Optional 3D illustration above the title (decorative; it fades in after the text). */
  art?: IllustrationName;
  className?: string;
}

/** Calm empty view: what is missing and, if useful, the next step. */
export function EmptyState({ title, description, action, art, className }: EmptyStateProps) {
  return (
    <section className={cx(styles.empty, className)}>
      {art ? <Illustration name={art} width={144} decorative className={styles.emptyArt} /> : null}
      <h2 className={styles.emptyTitle}>{title}</h2>
      {description ? <div className={styles.emptyBody}>{description}</div> : null}
      {action ? <div className={styles.emptyAction}>{action}</div> : null}
    </section>
  );
}
