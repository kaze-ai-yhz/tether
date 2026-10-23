import { formatSimDate } from "@/components";
import type { ClinicalNote, PatientDetail } from "@/lib/types";
import { AiPlanBlock } from "./AiPlanBlock";
import { parseNote, plural } from "./format";
import { NoteDisclosure } from "./NoteDisclosure";
import { ToneChip } from "./ToneChip";
import styles from "./patients.module.css";

function NoteTitle({ note, patient, latest }: { note: ClinicalNote; patient: PatientDetail; latest: boolean }) {
  const lines = patient.overrides.filter((o) => o.note_id === note.note_id);
  const notApplied = lines.filter((o) => o.status !== "APPLIED").length;
  const blocked = lines.some((o) => o.status === "SAFETY_BLOCKED");
  return (
    <span className={styles.noteTitle}>
      <span className={styles.mono}>{note.note_id}</span>
      <span>{formatSimDate(note.note_date) ?? note.note_date}</span>
      <span className={styles.noteMeta}>{note.clinician}</span>
      {note.has_ai_plan ? <ToneChip tone="neutral" label={`AI Plan · ${plural(lines.length, "line", "lines")}`} /> : null}
      {notApplied ? (
        <ToneChip
          tone={blocked ? "alert" : "caution"}
          icon={blocked ? "triangle" : "eye"}
          label={`${notApplied} not applied`}
        />
      ) : null}
      {latest ? <span className={styles.noteMeta}>Latest note</span> : null}
    </span>
  );
}

/** Faiz's CLINICAL_NOTES for the patient, newest first; the newest (and the latest AI Plan) open. */
export function NotesSection({ patient }: { patient: PatientDetail }) {
  const notes = [...patient.notes].sort(
    (a, b) => b.note_date.localeCompare(a.note_date) || b.note_id.localeCompare(a.note_id),
  );
  if (notes.length === 0) {
    return <p className={styles.emptyLine}>No clinical notes in the synthetic record.</p>;
  }
  const latestPlanId = notes.find((n) => n.has_ai_plan)?.note_id ?? null;

  return (
    <div className={styles.notes}>
      {notes.map((note, i) => {
        const parsed = parseNote(note.note_text);
        return (
          <NoteDisclosure
            key={note.note_id}
            id={note.note_id}
            defaultExpanded={i === 0 || note.note_id === latestPlanId}
            title={<NoteTitle note={note} patient={patient} latest={i === 0} />}
          >
            <div className={styles.noteBody}>
              {parsed.body ? <p className={styles.noteText}>{parsed.body}</p> : null}
              {parsed.plan ? (
                <AiPlanBlock
                  note={note}
                  plan={parsed.plan}
                  patient={patient}
                  isLatestPlan={note.note_id === latestPlanId}
                />
              ) : null}
              {parsed.trailing ? <p className={styles.planTrailing}>{parsed.trailing}</p> : null}
            </div>
          </NoteDisclosure>
        );
      })}
    </div>
  );
}
