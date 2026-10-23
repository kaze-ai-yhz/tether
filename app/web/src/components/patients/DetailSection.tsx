import type { ReactNode } from "react";
import styles from "./patients.module.css";

export interface DetailSectionProps {
  id: string;
  title: string;
  /** Short count line from the data, e.g. "5 todos, 0 done". */
  count?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}

/** One titled section of the patient detail page; `id` is the in-page link target. */
export function DetailSection({ id, title, count, aside, children }: DetailSectionProps) {
  return (
    <section id={id} className={styles.section} aria-labelledby={`${id}-title`}>
      <div className={styles.sectionHead}>
        <h2 id={`${id}-title`}>{title}</h2>
        {count ? <span className={styles.sectionCount}>{count}</span> : null}
        {aside ? <div className={styles.sectionAside}>{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}
