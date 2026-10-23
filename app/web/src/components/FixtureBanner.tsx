import type { ReactNode } from "react";
import { cx } from "./cx";
import { Icon } from "./icons";
import styles from "./states.module.css";

export interface FixtureBannerProps {
  /** Renders nothing unless true (pass the API response's `fixtures` flag). */
  fixtures?: boolean;
  message?: ReactNode;
  className?: string;
}

/** Says plainly that the screen shows saved fixture rows, not live Snowflake data. */
export function FixtureBanner({ fixtures = false, message, className }: FixtureBannerProps) {
  if (!fixtures) return null;
  return (
    <div className={cx(styles.banner, className)} role="note">
      <svg className={styles.bannerEdge} aria-hidden="true" focusable="false">
        <rect x="0.5" y="0.5" rx="4" />
      </svg>
      <Icon name="info" />
      <span className={styles.bannerText}>
        {message ?? (
          <>
            <strong>Fixture data.</strong> Snowflake is not connected, so screens show saved fixture rows and
            actions change nothing.
          </>
        )}
      </span>
    </div>
  );
}
