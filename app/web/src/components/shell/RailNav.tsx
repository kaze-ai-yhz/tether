"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Button } from "../Button";
import { Icon, type IconName } from "../icons";
import { useShell } from "./ShellContext";
import styles from "./shell.module.css";

interface NavEntry {
  href: "/" | "/patients" | "/rules";
  label: string;
  icon: IconName;
}

const NAV: NavEntry[] = [
  { href: "/", label: "Queue", icon: "queue" },
  { href: "/patients", label: "Patients", icon: "patients" },
  { href: "/rules", label: "Rules", icon: "rules" },
];

function isActive(pathname: string, href: NavEntry["href"]): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** Left rail: 56 px collapsed / 224 px expanded. */
export function RailNav() {
  const pathname = usePathname() ?? "/";
  const { appState } = useShell();
  const [expanded, setExpanded] = useState(true);
  const pending = typeof appState?.pending_count === "number" ? appState.pending_count : null;

  return (
    <nav className={styles.rail} data-expanded={expanded} aria-label="Main">
      <ul className={styles.navList}>
        {NAV.map((entry) => {
          const active = isActive(pathname, entry.href);
          const count = entry.href === "/" ? pending : null;
          return (
            <li key={entry.href} className={styles.navItem}>
              <Link href={entry.href} className={styles.navLink} aria-current={active ? "page" : undefined}>
                <Icon name={entry.icon} className={styles.navIcon} />
                <span className={styles.navText}>{entry.label}</span>
                {count != null ? (
                  <span className={styles.navCount} aria-label={`${count} pending`}>
                    {count}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
      <Button
        variant="tertiary"
        size="sm"
        iconOnly
        icon={expanded ? "chevronLeft" : "chevronRight"}
        aria-label={expanded ? "Collapse navigation" : "Expand navigation"}
        aria-expanded={expanded}
        onPress={() => setExpanded((value) => !value)}
        className={styles.railToggle}
      />
    </nav>
  );
}
