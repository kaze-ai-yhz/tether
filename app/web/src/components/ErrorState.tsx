import { Button } from "./Button";
import { cx } from "./cx";
import { Icon } from "./icons";
import styles from "./states.module.css";

export interface ErrorStateProps {
  /** Calm, specific headline, e.g. "Could not load the queue". */
  title?: string;
  /** The error text as returned (Snowflake message, HTTP status). Shown verbatim in mono. */
  message?: string | null;
  /** Machine code, e.g. SNOWFLAKE_REFUSED. */
  code?: string | null;
  /** Retry handler (client components only). */
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

export function ErrorState({
  title = "Could not load this view",
  message,
  code,
  onRetry,
  retryLabel = "Try again",
  className,
}: ErrorStateProps) {
  return (
    <section className={cx(styles.error, className)} role="alert">
      <div className={styles.errorHead}>
        <Icon name="triangle" />
        <span>{title}</span>
      </div>
      {message ? <pre className={styles.errorMessage}>{message}</pre> : null}
      {code ? <span className={styles.errorCode}>{code}</span> : null}
      {onRetry ? (
        <div>
          <Button variant="secondary" size="sm" onPress={onRetry}>
            {retryLabel}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
