import Link from "next/link";
import { EmptyState, ErrorState, Icon, SimulatedTag } from "@/components";
import {
  ActionsList,
  CallsSection,
  DetailSection,
  MonitoredTable,
  NotesSection,
  PatientHeader,
  RetryButton,
  SourceTag,
  Timeline,
  TodosTable,
  plural,
  type CitationLookup,
  type ReadyCall,
} from "@/components/patients";
import styles from "@/components/patients/patients.module.css";
import { getPatientDetail, getRules, getState, getTimeline } from "@/lib/data";
import type { PatientDetail } from "@/lib/types";
import { parsePatientId } from "@/lib/validate";

function Missing({ title, message }: { title: string; message: string }) {
  return (
    <>
      <Link href="/patients" className={styles.back}>
        <Icon name="chevronLeft" size={14} />
        All patients
      </Link>
      <EmptyState title={title} description={message} />
    </>
  );
}

function SectionNav({ patient, events }: { patient: PatientDetail; events: number | null }) {
  const links: Array<[string, string, number | null]> = [
    ["notes", "Notes and AI Plan", patient.notes.length],
    ["todos", "Todos", patient.todos.length],
    ["monitored", "Monitored values", patient.monitored.length],
    ["actions", "Actions and decisions", patient.actions.length],
    ["calls", "AI check-in calls", patient.calls.length],
    ["timeline", "Timeline", events],
  ];
  return (
    <nav aria-label="Sections of this record" className={styles.pageNav}>
      {links.map(([id, label, count]) => (
        <a key={id} href={`#${id}`}>
          {label}
          {count !== null ? <span className={styles.sectionCount}>{count}</span> : null}
        </a>
      ))}
    </nav>
  );
}

// Patient detail: V_PATIENT_DETAIL (header, notes and AI Plan, Table 1, Table 2, drafts, calls)
// plus V_TIMELINE, V_RULES citations and V_APP_STATE.call_ready.
export default async function PatientDetailPage({ params }: PageProps<"/patients/[id]">) {
  const { id: rawId } = await params;
  const id = parsePatientId(rawId);
  if (!id.ok) return <Missing title="That is not a patient id" message={id.message} />;

  const [detail, timeline, rules, state] = await Promise.all([
    getPatientDetail(id.value),
    getTimeline(id.value),
    getRules(),
    getState(),
  ]);

  if (!detail.ok) {
    if (detail.error.code === "NOT_FOUND") {
      return <Missing title={`No patient ${id.value}`} message={detail.error.message} />;
    }
    return (
      <>
        <Link href="/patients" className={styles.back}>
          <Icon name="chevronLeft" size={14} />
          All patients
        </Link>
        <div className={styles.errorBlock}>
          <ErrorState title={`Could not load ${id.value}`} message={detail.error.message} code={detail.error.code} />
          <RetryButton />
        </div>
      </>
    );
  }

  const patient = detail.data;

  // Citations for LayerChips: V_RULES, else the patient's own firings.
  const citations: CitationLookup = {};
  for (const f of patient.firings) citations[f.rule_id] = { citation: f.citation, step: f.step };
  if (rules.ok) {
    for (const r of rules.data.rules) citations[r.rule_id] = { citation: r.citation, step: r.step };
  }

  const ready: ReadyCall[] = state.ok
    ? (state.data.call_ready ?? [])
        .filter((c) => c.patient_id === patient.patient_id)
        .map((c) => {
          const action = patient.actions.find((a) => a.action_id === c.action_id);
          return { action_id: c.action_id, rule_id: action?.rule_id ?? null, step: action?.step ?? null };
        })
    : [];

  const todosDone = patient.todos.filter((t) => t.done).length;
  const pending = patient.actions.filter((a) => a.status === "PENDING").length;
  const overdue = patient.monitored.filter((m) => !m.paused && (m.days_overdue ?? 0) > 0).length;

  return (
    <>
      <PatientHeader
        patient={patient}
        sourceTag={<SourceTag fixtures={detail.fixtures} source={detail.fixture_source} />}
        nav={<SectionNav patient={patient} events={timeline.ok ? timeline.data.length : null} />}
      />

      <div className={styles.sections}>
        <DetailSection
          id="notes"
          title="Notes and AI Plan"
          count={plural(patient.notes.length, "note", "notes")}
          aside="Signed lines are the clinician's; the status of each line comes from the rules"
        >
          <NotesSection patient={patient} />
        </DetailSection>

        <DetailSection
          id="todos"
          title="Todos"
          count={`Table 1 · ${todosDone} of ${plural(patient.todos.length, "todo", "todos")} done`}
          aside="Composed from RULES and the applied AI Plan lines"
        >
          <TodosTable patient={patient} citations={citations} />
        </DetailSection>

        <DetailSection
          id="monitored"
          title="Monitored values"
          count={`Table 2 · ${plural(patient.monitored.length, "reading type", "reading types")}, ${overdue} overdue`}
          aside="Overdue days and the ladder rung come from RULES"
        >
          <MonitoredTable rows={patient.monitored} />
        </DetailSection>

        <DetailSection
          id="actions"
          title="Actions and decisions"
          count={`${plural(patient.actions.length, "draft", "drafts")}, ${pending} waiting for approval`}
          aside="Sends are simulated"
        >
          <ActionsList actions={patient.actions} citations={citations} />
        </DetailSection>

        <DetailSection
          id="calls"
          title="AI check-in calls"
          count={plural(patient.calls.length, "call", "calls")}
          aside={<SimulatedTag label="Simulated calls" />}
        >
          {!state.ok ? (
            <p className={styles.cardLine}>
              Could not check which calls are ready to simulate: {state.error.message}
            </p>
          ) : null}
          <CallsSection patient={patient} ready={ready} />
        </DetailSection>

        <DetailSection
          id="timeline"
          title="Timeline"
          count={timeline.ok ? plural(timeline.data.length, "event", "events") : undefined}
          aside="From AUDIT_LOG, newest first"
        >
          {timeline.ok ? (
            <Timeline events={timeline.data} />
          ) : (
            <ErrorState title="Could not load the timeline" message={timeline.error.message} code={timeline.error.code} />
          )}
        </DetailSection>
      </div>
    </>
  );
}
