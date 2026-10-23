"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { RouterProvider } from "react-aria-components";
import { FixtureBanner } from "../FixtureBanner";
import { DemoPanel } from "./DemoPanel";
import { LiveRegion } from "./LiveRegion";
import { RailNav } from "./RailNav";
import { ShellProvider, useShell, type ActingAs } from "./ShellContext";
import { TopBar } from "./TopBar";
import styles from "./shell.module.css";

function ShellFixtureBanner() {
  const { fixtures } = useShell();
  if (!fixtures) return null;
  return (
    <div className={styles.banner}>
      <FixtureBanner fixtures />
    </div>
  );
}

/**
 * App frame: top bar, rail, main content, demo panel, footer line, live region.
 * Also provides react-aria client routing (RouterProvider) and the shell context (useShell).
 */
export function AppShell({ initialActingAs, children }: { initialActingAs: ActingAs; children: ReactNode }) {
  const router = useRouter();
  return (
    <RouterProvider navigate={(path) => router.push(path)}>
      <ShellProvider initialActingAs={initialActingAs}>
        <div className={styles.shell}>
          <a href="#main" className={styles.skipLink}>
            Skip to content
          </a>
          <TopBar />
          <ShellFixtureBanner />
          <RailNav />
          <main id="main" className={styles.main} tabIndex={-1}>
            <div className={styles.content}>{children}</div>
          </main>
          <DemoPanel />
          <footer className={styles.footer}>
            <span>Synthetic data only. Prototype, not for clinical use.</span>
            <span>A clinician approves every outbound action.</span>
          </footer>
        </div>
        <LiveRegion />
      </ShellProvider>
    </RouterProvider>
  );
}
