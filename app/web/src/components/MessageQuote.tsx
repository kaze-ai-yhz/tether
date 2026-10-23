import type { ReactNode } from "react";
import { cx } from "./cx";
import styles from "./MessageQuote.module.css";

export interface MessageQuoteProps {
  /** Verbatim patient-facing or patient-sent text. */
  children: ReactNode;
  /** Footer line, e.g. "Sent via SMS · simulated" or "Simulated call · attempt 1". */
  footer?: ReactNode;
  className?: string;
}

/** Sunken block with a 2px left rule for verbatim message text. */
export function MessageQuote({ children, footer, className }: MessageQuoteProps) {
  return (
    <figure className={cx(styles.quote, className)}>
      <blockquote className={styles.body}>{children}</blockquote>
      {footer ? <figcaption className={styles.footer}>{footer}</figcaption> : null}
    </figure>
  );
}
