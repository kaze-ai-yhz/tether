"use client";

import { useState } from "react";
import { Dialog, Heading, Label, Modal, ModalOverlay, Text, TextArea, TextField } from "react-aria-components";
import { Button } from "@/components";
import dialog from "@/components/dialog.module.css";

export interface EditDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  patientId: string;
  /** Current draft text, prefilled. */
  draftText: string;
  /** Resolves to an error message to keep the dialog open, or null when saved. */
  onSave: (editedText: string, note: string | null) => Promise<string | null>;
}

/** Edit a draft before approving it. The server re-runs the drug and dose check on the edited text. */
export function EditDialog({ isOpen, onOpenChange, patientId, draftText, onSave }: EditDialogProps) {
  return (
    <ModalOverlay isOpen={isOpen} onOpenChange={onOpenChange} isDismissable className={dialog.overlay}>
      <Modal className={dialog.modal}>
        <Dialog className={dialog.dialog}>
          {({ close }) => <EditForm patientId={patientId} draftText={draftText} onSave={onSave} close={close} />}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

function EditForm({
  patientId,
  draftText,
  onSave,
  close,
}: Pick<EditDialogProps, "patientId" | "draftText" | "onSave"> & { close: () => void }) {
  const [text, setText] = useState(draftText);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = text.trim().length > 0 && text.trim() !== draftText.trim();

  async function submit() {
    if (!ready || saving) return;
    setSaving(true);
    setError(null);
    const problem = await onSave(text.trim(), note.trim() || null);
    setSaving(false);
    if (problem) setError(problem);
    else close();
  }

  return (
    <form
      className={dialog.form}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Heading slot="title" className={dialog.title}>
        Edit the draft for {patientId}
      </Heading>
      <div className={dialog.description}>
        The edited text is checked again for drug names and doses before anything is sent.
      </div>
      <TextField value={text} onChange={setText} isRequired autoFocus className={dialog.field}>
        <Label className={dialog.label}>Draft text</Label>
        <TextArea className={dialog.textarea} rows={8} />
        <Text slot="description" className={dialog.hint}>
          {ready ? `${text.trim().length} characters` : "Change the text to approve an edit."}
        </Text>
      </TextField>
      <TextField value={note} onChange={setNote} className={dialog.field}>
        <Label className={dialog.label}>Note for the record (optional)</Label>
        <TextArea className={dialog.textarea} rows={2} />
      </TextField>
      {error ? (
        <p className={dialog.error} role="alert">
          {error}
        </p>
      ) : null}
      <div className={dialog.actions}>
        <Button variant="tertiary" onPress={close} isDisabled={saving}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" isDisabled={!ready} isPending={saving}>
          Approve edited draft
        </Button>
      </div>
    </form>
  );
}
