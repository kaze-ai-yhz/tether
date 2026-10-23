"use client";

import { useState, type ReactNode } from "react";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { Button } from "./Button";
import type { ConfirmResult } from "./ReasonDialog";
import styles from "./dialog.module.css";

export interface ConfirmDialogProps {
  /** Controlled open state. Omit both to use the dialog inside a react-aria <DialogTrigger>. */
  isOpen?: boolean;
  onOpenChange?: (isOpen: boolean) => void;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Destructive actions (Reset demo) use the alert outline button and an alertdialog role. */
  destructive?: boolean;
  onConfirm: () => ConfirmResult;
  isPending?: boolean;
  error?: string | null;
}

/** Confirmation step for actions that are hard to undo. */
export function ConfirmDialog({ isOpen, onOpenChange, ...body }: ConfirmDialogProps) {
  return (
    <ModalOverlay isOpen={isOpen} onOpenChange={onOpenChange} isDismissable={!body.isPending} className={styles.overlay}>
      <Modal className={styles.modal}>
        <Dialog className={styles.dialog} role={body.destructive ? "alertdialog" : "dialog"}>
          {({ close }) => <ConfirmBody {...body} close={close} />}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

type ConfirmBodyProps = Omit<ConfirmDialogProps, "isOpen" | "onOpenChange"> & { close: () => void };

function ConfirmBody({
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  isPending = false,
  error: externalError,
  close,
}: ConfirmBodyProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = submitting || isPending;

  async function confirm() {
    if (busy) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await onConfirm();
      setSubmitting(false);
      if (result !== false) close();
    } catch (e) {
      setSubmitting(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const shownError = error ?? externalError ?? null;

  return (
    <>
      <Heading slot="title" className={styles.title}>
        {title}
      </Heading>
      {children ? <div className={styles.description}>{children}</div> : null}
      {shownError ? (
        <p className={styles.error} role="alert">
          {shownError}
        </p>
      ) : null}
      <div className={styles.actions}>
        <Button variant="tertiary" onPress={close} isDisabled={busy} autoFocus>
          {cancelLabel}
        </Button>
        <Button variant={destructive ? "destructive" : "primary"} onPress={() => void confirm()} isPending={busy}>
          {confirmLabel}
        </Button>
      </div>
    </>
  );
}
