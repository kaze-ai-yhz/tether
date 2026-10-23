"use client";

import type { CSSProperties, ReactNode } from "react";
import {
  Cell,
  Column,
  Row,
  Table,
  TableBody,
  TableHeader,
  composeRenderProps,
  type CellProps,
  type ColumnProps,
  type RowProps,
  type TableBodyProps,
  type TableHeaderProps,
  type TableProps,
} from "react-aria-components";
import { cx } from "./cx";
import styles from "./DataTable.module.css";

/**
 * react-aria Table pieces with Tether styling: keyboard row navigation, sortable columns,
 * sticky header (inside DataTableScroll), tabular numerals. Rows accept `href` for links
 * (client-side routing via the RouterProvider in the app shell) or `onRowAction` on the table.
 */

export interface DataTableScrollProps {
  children: ReactNode;
  /** Height limit that makes the header stick, e.g. "calc(100vh - 240px)". */
  maxHeight?: CSSProperties["maxHeight"];
  className?: string;
}

export function DataTableScroll({ children, maxHeight, className }: DataTableScrollProps) {
  return (
    <div className={cx(styles.scroll, className)} style={maxHeight ? { maxHeight } : undefined}>
      {children}
    </div>
  );
}

export function DataTable(props: TableProps) {
  return <Table {...props} className={composeRenderProps(props.className, (c) => cx(styles.table, c))} />;
}

export function DataTableHeader<T extends object>(props: TableHeaderProps<T>) {
  return <TableHeader {...props} />;
}

export interface DataColumnProps extends ColumnProps {
  /** Right-aligns the header for number columns. */
  numeric?: boolean;
}

export function DataColumn({ numeric = false, children, ...props }: DataColumnProps) {
  return (
    <Column
      {...props}
      className={composeRenderProps(props.className, (c) => cx(styles.column, numeric && styles.numeric, c))}
    >
      {composeRenderProps(children, (content, { allowsSorting, sortDirection }) => (
        <>
          {content}
          {allowsSorting ? (
            <span className={styles.sortIndicator} aria-hidden="true">
              {sortDirection === "ascending" ? "▲" : sortDirection === "descending" ? "▼" : "↕"}
            </span>
          ) : null}
        </>
      ))}
    </Column>
  );
}

export function DataTableBody<T extends object>(props: TableBodyProps<T>) {
  return (
    <TableBody
      {...props}
      renderEmptyState={props.renderEmptyState ?? (() => <div className={styles.empty}>No rows</div>)}
    />
  );
}

export function DataRow<T extends object>(props: RowProps<T>) {
  return <Row {...props} className={composeRenderProps(props.className, (c) => cx(styles.row, c))} />;
}

export interface DataCellProps extends CellProps {
  numeric?: boolean;
  mono?: boolean;
}

export function DataCell({ numeric = false, mono = false, ...props }: DataCellProps) {
  return (
    <Cell
      {...props}
      className={composeRenderProps(props.className, (c) =>
        cx(styles.cell, numeric && styles.numeric, mono && styles.mono, c),
      )}
    />
  );
}
