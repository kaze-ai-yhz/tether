"use client";

import { useEffect, useRef, useState } from "react";
import { Button as AriaButton, Disclosure, DisclosurePanel } from "react-aria-components";
import { Button } from "../Button";
import { cx } from "../cx";
import { Icon } from "../icons";
import styles from "./ask.module.css";

export interface SqlDisclosureProps {
  /** SQL the agent ran; null when the answer came back without SQL. */
  sql: string | null;
  className?: string;
}

type CopyState = "idle" | "copied" | "failed";

/** "Show SQL" disclosure, collapsed by default, with the SQL in a scrollable mono block and a copy button. */
export function SqlDisclosure({ sql, className }: SqlDisclosureProps) {
  const [copy, setCopy] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  if (!sql?.trim()) {
    return <p className={cx(styles.muted, className)}>No SQL was returned for this answer.</p>;
  }

  async function copySql(text: string) {
    let next: CopyState = "copied";
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      next = "failed";
    }
    setCopy(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopy("idle"), 2000);
  }

  return (
    <Disclosure className={cx(styles.sqlDisclosure, className)}>
      {({ isExpanded }) => (
        <>
          <AriaButton slot="trigger" className={styles.sqlTrigger}>
            <Icon name="chevronRight" size={14} className={styles.sqlChevron} />
            {isExpanded ? "Hide SQL" : "Show SQL"}
          </AriaButton>
          <DisclosurePanel className={styles.sqlPanel}>
            <div className={styles.sqlToolbar}>
              <span className={styles.sqlCaption}>SQL that ran</span>
              <span className={styles.srOnly} aria-live="polite">
                {copy === "copied" ? "SQL copied" : copy === "failed" ? "Could not copy the SQL" : ""}
              </span>
              <Button variant="tertiary" size="sm" icon={copy === "copied" ? "check" : undefined} onPress={() => void copySql(sql)}>
                {copy === "copied" ? "Copied" : copy === "failed" ? "Copy failed" : "Copy SQL"}
              </Button>
            </div>
            <pre className={styles.sql} tabIndex={0} aria-label="SQL that ran">
              <code>{sql}</code>
            </pre>
          </DisclosurePanel>
        </>
      )}
    </Disclosure>
  );
}
