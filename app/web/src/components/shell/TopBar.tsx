"use client";

import Link from "next/link";
import type { Key } from "react-aria-components";
import { Dialog, DialogTrigger, Heading, Popover, ToggleButton, ToggleButtonGroup } from "react-aria-components";
import { Button } from "../Button";
import { Icon } from "../icons";
import { SimulatedTag } from "../SimulatedTag";
import { formatSimDate } from "../format";
import { ACTING_AS_LABEL, useShell, type ActingAs } from "./ShellContext";
import styles from "./shell.module.css";

function SimClock() {
  const { appState, stateLoading, stateError } = useShell();
  const date = formatSimDate(appState?.as_of_date ?? null);
  return (
    <div className={styles.clock}>
      <Icon name="clock" className={styles.clockIcon} />
      {date ? (
        <span>
          As of{" "}
          <time key={date} dateTime={appState?.as_of_date ?? undefined} className="motion-flip">
            {date}
          </time>{" "}
          <span className={styles.clockSim}>(simulated)</span>
        </span>
      ) : (
        <span>
          As of {stateLoading ? "…" : "unknown date"} <span className={styles.clockSim}>(simulated)</span>
        </span>
      )}
      {!stateLoading && stateError ? <span className={styles.clockError}>· state unavailable</span> : null}
    </div>
  );
}

function ActingAsSwitch() {
  const { actingAs, setActingAs, isSwitchingRole } = useShell();
  const options: ActingAs[] = ["agent", "clinician"];
  return (
    <div className={styles.actingAs}>
      <span className={styles.actingLabel} id="acting-as-label">
        Acting as
      </span>
      <ToggleButtonGroup
        aria-labelledby="acting-as-label"
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={[actingAs]}
        isDisabled={isSwitchingRole}
        onSelectionChange={(keys: Set<Key>) => {
          const next = [...keys][0];
          if (next === "agent" || next === "clinician") void setActingAs(next);
        }}
        className={styles.segmented}
      >
        {options.map((option) => (
          <ToggleButton key={option} id={option} className={styles.segment}>
            <span className={styles.segmentDot} aria-hidden="true" />
            {ACTING_AS_LABEL[option]}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </div>
  );
}

function AskButton() {
  return (
    <DialogTrigger>
      <Button variant="tertiary" size="sm" icon="ask">
        Ask
      </Button>
      <Popover placement="bottom end" offset={8} className={styles.popover}>
        <Dialog className={styles.popoverDialog}>
          <Heading slot="title" className={styles.popoverTitle}>
            Ask is not connected yet
          </Heading>
          <p className={styles.popoverBody}>
            Ask will answer questions over the Tether views and show the SQL it ran. It is not part of this build yet.
          </p>
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}

/** Brand glyph: a thread between two points (home and clinic). Decorative; the wordmark names the link. */
function TetherGlyph() {
  return (
    <svg className={styles.brandMark} width="22" height="14" viewBox="0 0 22 14" aria-hidden="true" focusable="false">
      <path className={styles.brandThread} d="M4 10.5C8 2.5 13.5 13 18 3.5" />
      <circle className={styles.brandDot} cx="4" cy="10.5" r="2.25" />
      <circle className={styles.brandDot} cx="18" cy="3.5" r="2.25" />
    </svg>
  );
}

/** 48 px frame bar: wordmark, simulated clock, Acting as switch, Ask. */
export function TopBar() {
  const { appState } = useShell();
  const rolesSimulated = appState?.roles_mode === "SIMULATED";
  return (
    <header className={styles.topBar}>
      <Link href="/" className={styles.wordmark}>
        <TetherGlyph />
        Tether
      </Link>
      <SimClock />
      <div className={styles.topRight}>
        {rolesSimulated ? <SimulatedTag label="Role check simulated" /> : null}
        <ActingAsSwitch />
        <AskButton />
      </div>
    </header>
  );
}
