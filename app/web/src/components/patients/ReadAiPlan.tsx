"use client";

import { Button, StepLoader } from "@/components";
import { useWrite } from "./useWrite";
import { WriteOutcome } from "./WriteOutcome";
import styles from "./patients.module.css";

export interface ReadAiPlanProps {
  noteId: string;
  patientId: string;
  /** False once Claude's reading of this note is on file. The last result stays visible either way. */
  canRead: boolean;
}

/** "Read AI Plan with Claude": CALL READ_AI_PLAN(note_id) through POST /api/notes/:id/read. */
export function ReadAiPlan({ noteId, patientId, canRead }: ReadAiPlanProps) {
  const { busy, result, run } = useWrite("ai-plan-read");
  if (!canRead && !result) return null;

  function read() {
    void run("read", `/api/notes/${encodeURIComponent(noteId)}/read`, {}, (ok, text) =>
      ok ? `${patientId}: AI Plan in ${noteId} read. ${text}` : `${patientId}: the AI Plan in ${noteId} was not read. ${text}`,
    );
  }

  return (
    <div className={styles.planActions}>
      {canRead ? (
        <Button variant="secondary" size="sm" isDisabled={busy !== null} onPress={read}>
          Read AI Plan with Claude
        </Button>
      ) : null}
      {busy ? <StepLoader label="Claude is reading the AI Plan…" /> : null}
      <WriteOutcome result={result} okLead="Read." errorLead="Not read." />
    </div>
  );
}
