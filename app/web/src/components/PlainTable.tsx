import type { CSSProperties, ReactNode } from "react";
import { cx } from "./cx";
import styles from "./DataTable.module.css";

export interface PlainTableProps {
  /** <thead> and <tbody> markup. Use `tableCell.numeric` / `tableCell.mono` classes on cells. */
  children: ReactNode;
  caption?: ReactNode;
  /** Height limit that makes the header stick. */
  maxHeight?: CSSProperties["maxHeight"];
  className?: string;
}

/** Server-renderable native table with the same styling as DataTable (sticky header, tabular numerals). */
export function PlainTable({ children, caption, maxHeight, className }: PlainTableProps) {
  return (
    <div className={cx(styles.scroll, className)} style={maxHeight ? { maxHeight } : undefined}>
      <table className={styles.table}>
        {caption ? <caption>{caption}</caption> : null}
        {children}
      </table>
    </div>
  );
}

/** Cell modifier classes for PlainTable cells. */
export const tableCell = {
  numeric: styles.numeric,
  mono: styles.mono,
} as const;
