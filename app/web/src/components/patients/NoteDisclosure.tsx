"use client";

import type { ReactNode } from "react";
import { Button, Disclosure, DisclosurePanel, Heading } from "react-aria-components";
import { Icon } from "@/components";
import styles from "./patients.module.css";

export interface NoteDisclosureProps {
  /** Stable id (the note id) so the open state survives a refresh. */
  id: string;
  title: ReactNode;
  defaultExpanded?: boolean;
  children: ReactNode;
}

/** One clinical note: a heading button that shows or hides the note text. */
export function NoteDisclosure({ id, title, defaultExpanded = false, children }: NoteDisclosureProps) {
  return (
    <Disclosure id={id} defaultExpanded={defaultExpanded} className={styles.note}>
      <Heading level={3}>
        <Button slot="trigger" className={styles.noteTrigger}>
          <Icon name="chevronRight" className={styles.noteChevron} />
          {title}
        </Button>
      </Heading>
      <DisclosurePanel className={styles.notePanel}>{children}</DisclosurePanel>
    </Disclosure>
  );
}
