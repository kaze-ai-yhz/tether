"use client";

import { useState, type ReactNode } from "react";
import { Dialog, Heading, Label, Modal, ModalOverlay, Text, TextArea, TextField } from "react-aria-components";
import { Button } from "./Button";
import styles from "./dialog.module.css";

/** Return `false` (or throw) to keep the dialog open; a thrown Error's message is shown in the dialog. */
export type ConfirmResult = void | boolean | Promise<void | boolean>;

export interface ReasonDialogProps {
  /** Controlled open state. Omit both to use the dialog inside a react-aria <DialogTrigger>. */
  isOpen?: boolean;
  onOpenChange?: (isOpen: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Field label, default "Reason". */
  label?: string;
  placeholder?: string;
  /** Minimum trimmed length, default 10. */
  minLength?: number;
  defaultValue?: string;
  /** Uses the destructive (alert outline) confirm button. */
  destructive?: boolean;
  /** Receives the trimmed reason. */
  onConfirm: (reason: string) => ConfirmResult;
  isPending?: boolean;
  /** Error from the caller, shown above the actions. */
  error?: string | null;
}

/** Reject, threshold edit, resolve: requires a reason or statement of at least 10 characters. */
export function ReasonDialog({ isOpen, onOpenChange, ...form }: ReasonDialogProps) {
  return (
    <ModalOverlay isOpen={isOpen} onOpenChange={onOpenChange} isDismissable={!form.isPending} className={styles.overlay}>
      <Modal className={styles.modal}>
        <Dialog className={styles.dialog}>{({ close }) => <ReasonForm {...form} close={close} />}</Dialog>
      </Modal>
    </ModalOverlay>
  );
}

type ReasonFormProps = Omit<ReasonDialogProps, "isOpen" | "onOpenChange"> & { close: () => void };

function ReasonForm({
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  label = "Reason",
  placeholder,
  minLength = 10,
  defaultValue = "",
  destructive = false,
  onConfirm,
  isPending = false,
  error: externalError,
  close,
}: ReasonFormProps) {
  const [reason, setReason] = useState(defaultValue);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const count = reason.trim().length;
  const ready = count >= minLength;
  const busy = submitting || isPending;

  async function submit() {
    if (!ready || busy) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await onConfirm(reason.trim());
      setSubmitting(false);
      if (result !== false) close();
    } catch (e) {
      setSubmitting(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const shownError = error ?? externalError ?? null;

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Heading slot="title" className={styles.title}>
        {title}
      </Heading>
      {description ? <div className={styles.description}>{description}</div> : null}
      <TextField value={reason} onChange={setReason} isRequired autoFocus className={styles.field}>
        <Label className={styles.label}>{label}</Label>
        <TextArea className={styles.textarea} placeholder={placeholder} rows={4} />
        <Text slot="description" className={styles.hint}>
          {ready ? `${count} characters` : `At least ${minLength} characters (${count} so far)`}
        </Text>
      </TextField>
      {shownError ? (
        <p className={styles.error} role="alert">
          {shownError}
        </p>
      ) : null}
      <div className={styles.actions}>
        <Button variant="tertiary" onPress={close} isDisabled={busy}>
          {cancelLabel}
        </Button>
        <Button type="submit" variant={destructive ? "destructive" : "primary"} isDisabled={!ready} isPending={busy}>
          {confirmLabel}
        </Button>
      </div>
    </form>
  );
}
