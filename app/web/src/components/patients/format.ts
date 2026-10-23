import type { IconName } from "@/components";
import type {
  CallOutcome,
  CarePlan,
  Condition,
  OutboxChannel,
  OverrideLine,
  OverrideStatus,
  PatientListRow,
  PlanReading,
  PlanReadingLine,
  ReadingType,
  Recipient,
  TodoKind,
} from "@/lib/types";
import type { StatusTone } from "@/styles/tokens";

// Display helpers for the patients screens: labels for the codes the views emit, the AI Plan
// block split (the same cut V_PATIENT_OVERRIDES makes), and small text formatters. Isomorphic:
// used by server pages and client components alike.

export interface ToneSpec {
  label: string;
  tone: StatusTone;
  icon: IconName;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

/** "DO_NOT_CONTACT" -> "Do not contact". */
export function sentenceCase(code: string): string {
  const words = code.replace(/[_\s]+/g, " ").trim().toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : code;
}

// ---------------------------------------------------------------------------------------------
// Codes -> words
// ---------------------------------------------------------------------------------------------

export const CONDITION_LABEL: Record<Condition | "PLAN", string> = {
  HTN: "Hypertension",
  COPD: "COPD",
  T2DM: "Type 2 diabetes",
  PLAN: "AI Plan review",
};

export function conditionLabel(code: string): string {
  return (CONDITION_LABEL as Record<string, string>)[code] ?? code;
}

export const READING_LABEL: Record<ReadingType, string> = {
  BP: "Blood pressure",
  SPO2: "SpO2",
  A1C: "A1C",
  GLUCOSE: "Glucose",
  EXACERBATION: "Exacerbations",
  ADHERENCE: "Adherence",
  BARRIER: "Barrier",
};

export function readingLabel(code: string): string {
  return (READING_LABEL as Record<string, string>)[code] ?? sentenceCase(code);
}

export const RECIPIENT_LABEL: Record<Recipient, string> = {
  PATIENT: "Patient",
  PRESCRIBER: "Prescriber",
  CLINICIAN: "Clinician",
  NONE: "No one",
};

export const CHANNEL_LABEL: Record<OutboxChannel, string> = {
  SMS: "SMS",
  AI_CALL: "AI check-in call",
  PRESCRIBER: "prescriber inbox",
  PHARMACY: "pharmacy",
  CLINICIAN: "clinician inbox",
  INTERNAL_ALERT: "internal alert",
};

export function channelLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return (CHANNEL_LABEL as Record<string, string>)[code] ?? sentenceCase(code);
}

export const TODO_KIND_LABEL: Record<TodoKind, string> = {
  COLLECT: "Collect",
  WATCH: "Watch",
  REVIEW: "Review",
  LIFESTYLE: "Lifestyle",
};

/** Faiz's OVERRIDE_KEYS settings, in the words of his RUNBOOK keys. */
const SETTING_LABEL: Record<string, string> = {
  A1C_GOAL: "A1C goal",
  BP_GOAL: "BP goal",
  HOLD_ESCALATION_UNTIL: "Hold escalation",
  AI_CALLS: "AI calls",
  CONTACT_WINDOW: "Contact window",
  LANGUAGE: "Language",
  DO_NOT_CONTACT: "Do not contact",
  CHECKINS: "Check-ins",
  REMINDER_CHANNEL: "Reminders",
  NOTIFY_IF: "Notify me if",
};

export function settingLabel(setting: string): string {
  return SETTING_LABEL[setting] ?? sentenceCase(setting);
}

/** The code decides each AI Plan line (Faiz's V_PATIENT_OVERRIDES.status). */
export const OVERRIDE_STATUS: Record<OverrideStatus, ToneSpec> = {
  APPLIED: { label: "Applied", tone: "ok", icon: "circleCheck" },
  SAFETY_BLOCKED: { label: "Blocked: safety rule", tone: "alert", icon: "triangle" },
  NEEDS_CONFIRMATION: { label: "Held for confirmation", tone: "caution", icon: "eye" },
  UNRECOGNIZED: { label: "Not recognized", tone: "caution", icon: "circleDashed" },
};

/** One sentence per non-applied status (RUNBOOK "SOAP notes and the AI Plan", safety rules). */
export const OVERRIDE_STATUS_NOTE: Record<OverrideStatus, string | null> = {
  APPLIED: null,
  SAFETY_BLOCKED:
    "Not applied. A plan line cannot weaken a red flag or the approval gate; red flags still fire. Flagged for clinician review.",
  NEEDS_CONFIRMATION:
    "Not applied. The value is outside the accepted range or unclear, so it waits for the clinician to confirm it.",
  UNRECOGNIZED: "Not applied. The key is not one Tether recognizes. Flagged for clinician review.",
};

export function overrideSpec(status: string): ToneSpec {
  return (OVERRIDE_STATUS as Record<string, ToneSpec>)[status] ?? { label: sentenceCase(status), tone: "neutral", icon: "circleDashed" };
}

export const CALL_OUTCOME: Record<CallOutcome, ToneSpec> = {
  ANSWERED: { label: "Answered", tone: "ok", icon: "circleCheck" },
  NO_ANSWER: { label: "No answer", tone: "caution", icon: "clock" },
  HANDOFF: { label: "Handed off to a clinician", tone: "alert", icon: "triangle" },
  ID_FAILED: { label: "Identity not confirmed", tone: "alert", icon: "circleX" },
};

export function callOutcomeSpec(outcome: string): ToneSpec {
  return (CALL_OUTCOME as Record<string, ToneSpec>)[outcome] ?? { label: sentenceCase(outcome), tone: "neutral", icon: "circleDashed" };
}

/** AUDIT_LOG events written by Faiz's procs (APPROVED/EDITED/REJECTED) and by Tether. */
const EVENT_LABEL: Record<string, string> = {
  AI_PLAN_READ: "AI Plan read",
  PLAN_COMPOSED: "Plan composed",
  PLAN_REJECTED: "Plan rejected",
  RULE_EDITED: "Rule edited",
  CLOCK_ADVANCED: "Clock advanced (simulated)",
  DRAFTS_GENERATED: "Drafts generated",
  RED_FLAG_ALERT: "Red-flag alert",
  SENT: "Sent (simulated)",
  REVIEW_DENIED: "Review refused by Snowflake",
  CALL_ATTEMPT: "Check-in call (simulated)",
  CALL_HANDOFF: "Call handed off to a clinician",
  CLINICIAN_DECISION: "Clinician decision",
  DEMO_RESET: "Demo reset",
  APPROVED: "Approved",
  EDITED: "Approved with edits",
  REJECTED: "Rejected",
};

export function eventLabel(event: string): string {
  return EVENT_LABEL[event] ?? sentenceCase(event);
}

export type ActorKind = "human" | "machine" | "user";

/** Role labels Tether writes (CLINICIAN, CARE_AGENT); Faiz's procs write the Snowflake user name. */
export function actorKind(actor: string): ActorKind {
  if (/clinician|doctor|^dr\b/i.test(actor)) return "human";
  if (/agent|system|tether|claude|cortex|model|task/i.test(actor)) return "machine";
  return "user";
}

export function actorLabel(actor: string): string {
  if (actor === "CARE_AGENT") return "Care agent";
  if (actor === "CLINICIAN") return "Clinician";
  return actor;
}

// ---------------------------------------------------------------------------------------------
// Dates and numbers
// ---------------------------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** ISO timestamp text ("2026-10-23T13:40:01.000" or "2026-10-23 13:40:01") -> "Oct 23, 2026 · 13:40". */
export function formatStamp(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(iso);
  if (!m) return iso;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return iso;
  const date = `${month} ${Number(m[3])}, ${m[1]}`;
  return m[4] ? `${date} · ${m[4]}:${m[5]}` : date;
}

/** Same as formatStamp, with seconds, for the audit timeline. */
export function formatStampSeconds(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/.exec(iso);
  if (!m) return formatStamp(iso) ?? iso;
  const month = MONTHS[Number(m[2]) - 1] ?? m[2];
  return `${month} ${Number(m[3])}, ${m[1]} · ${m[4]}:${m[5]}:${m[6]}`;
}

/**
 * Heat step 1-5 on the overdue ramp. The step follows the ladder rung the view computed from
 * RULES (ENG-1..ENG-4), so no day threshold is repeated here.
 */
export function overdueStep(daysOverdue: number | null, rung: string | null): number {
  if (daysOverdue === null || daysOverdue <= 0) return 0;
  switch (rung) {
    case "ENG-1":
      return 2;
    case "ENG-2":
      return 3;
    case "ENG-3":
    case "ENG-3H":
      return 4;
    case "ENG-4":
      return 5;
    default:
      return 1;
  }
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// ---------------------------------------------------------------------------------------------
// Patient list
// ---------------------------------------------------------------------------------------------

export interface StatusCount {
  status: string;
  rank: number;
  count: number;
}

/** Patients per display status, most severe first. */
export function statusCounts(rows: PatientListRow[]): StatusCount[] {
  const map = new Map<string, StatusCount>();
  for (const row of rows) {
    const entry = map.get(row.display_status) ?? { status: row.display_status, rank: row.status_rank, count: 0 };
    entry.count += 1;
    map.set(row.display_status, entry);
  }
  return [...map.values()].sort((a, b) => a.rank - b.rank);
}

// ---------------------------------------------------------------------------------------------
// Preferences and drafts
// ---------------------------------------------------------------------------------------------

export interface PrefItem {
  setting: string;
  label: string;
  value: string;
}

/** "LANGUAGE: Spanish; CONTACT_WINDOW: after 6 PM only" -> [{setting, label, value}, ...]. */
export function parsePrefs(prefs: string | null | undefined): PrefItem[] {
  if (!prefs) return [];
  return prefs
    .split(/;\s*(?=[A-Z][A-Z0-9_]*:)/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const m = /^([A-Z][A-Z0-9_]*):\s*([\s\S]*)$/.exec(part);
      return m ? { setting: m[1], label: settingLabel(m[1]), value: m[2].trim() } : { setting: "", label: "", value: part };
    });
}

/** Splits a draft at its "Why:" line. */
export function splitWhy(text: string | null | undefined): { body: string; why: string | null } {
  const value = text ?? "";
  const m = /(^|\n)\s*Why:\s*/i.exec(value);
  if (!m) return { body: value.trim(), why: null };
  const why = value.slice(m.index + m[0].length).trim();
  return { body: value.slice(0, m.index).trim(), why: why || null };
}

/** Structured call answers (a VARIANT written from SQL values) as label/value pairs. */
export function answerEntries(answers: unknown): Array<[string, string]> {
  const value = parseJson(answers);
  if (!isRecord(value)) return [];
  return Object.entries(value).map(([key, v]) => {
    const text =
      v === null || v === undefined
        ? "Not recorded"
        : typeof v === "string"
          ? v
          : typeof v === "object"
            ? JSON.stringify(v)
            : String(v);
    return [sentenceCase(key), text];
  });
}

// ---------------------------------------------------------------------------------------------
// AI Plan block
// ---------------------------------------------------------------------------------------------

const PLAN_MARK = "AI PLAN";

export interface AiPlanText {
  /** "AI PLAN (clinician directives; supersede the note and rule defaults)". */
  header: string;
  /** Trimmed, non-empty lines between the header and "Signed:". */
  lines: string[];
  /** "Signed: Dr. Synthetic   2026-10-10", or null when unsigned. */
  signature: string | null;
}

export interface ParsedNote {
  /** Note text before the AI PLAN block (the whole note when it has none). */
  body: string;
  plan: AiPlanText | null;
  /** Any text after the signature line, shown as written. */
  trailing: string;
}

/**
 * Splits a CLINICAL_NOTES text the way V_PATIENT_OVERRIDES does: the section is the text
 * between the first "AI PLAN" and "Signed:", one directive per line.
 */
export function parseNote(text: string): ParsedNote {
  const at = text.indexOf(PLAN_MARK);
  if (at < 0) return { body: text.trim(), plan: null, trailing: "" };
  const body = text.slice(0, at).trim();
  const after = text.slice(at + PLAN_MARK.length);
  const nextMark = after.indexOf(PLAN_MARK);
  const part = nextMark >= 0 ? after.slice(0, nextMark) : after;
  const signedAt = part.indexOf("Signed:");
  const section = signedAt >= 0 ? part.slice(0, signedAt) : part;
  const [first = "", ...rest] = section.split("\n");
  let signature: string | null = null;
  let trailing = nextMark >= 0 ? after.slice(nextMark) : "";
  if (signedAt >= 0) {
    const eol = part.indexOf("\n", signedAt);
    signature = (eol >= 0 ? part.slice(signedAt, eol) : part.slice(signedAt)).trim();
    trailing = `${eol >= 0 ? part.slice(eol + 1) : ""}${trailing}`;
  }
  return {
    body,
    plan: {
      header: `${PLAN_MARK}${first}`.trim(),
      lines: rest.map((line) => line.trim()).filter(Boolean),
      signature,
    },
    trailing: trailing.trim(),
  };
}

/** A "- Key: value" line, the only kind V_PATIENT_OVERRIDES evaluates. */
export function isDirectiveLine(line: string): boolean {
  return line.startsWith("- ") && line.includes(":");
}

export function overrideFor(overrides: OverrideLine[], noteId: string, line: string): OverrideLine | undefined {
  return overrides.find((o) => o.note_id === noteId && o.line.trim() === line);
}

function normalizeLine(line: string): string {
  return line.replace(/^\s*-\s*/, "").replace(/\s+/g, " ").trim().toLowerCase();
}

function lineKey(line: string): string {
  const n = normalizeLine(line);
  const colon = n.indexOf(":");
  return colon > 0 ? n.slice(0, colon) : n;
}

/** Claude's reading as an object, or null when the plan has not been read (or the shape is unusable). */
export function readingOf(plan: CarePlan | null): PlanReading | null {
  const value = parseJson(plan?.reading ?? null);
  if (!isRecord(value)) return null;
  const summary = typeof value.summary === "string" ? value.summary.trim() : "";
  const lines: PlanReadingLine[] = Array.isArray(value.lines)
    ? value.lines.filter(isRecord).map((l) => ({
        line: typeof l.line === "string" ? l.line : "",
        meaning: typeof l.meaning === "string" ? l.meaning : "",
        concern: typeof l.concern === "string" && l.concern.trim() ? l.concern.trim() : null,
      }))
    : [];
  if (!summary && lines.length === 0) return null;
  return { summary, lines };
}

/**
 * Pairs Claude's per-line readings with the note's lines: exact text first, then the same key.
 * Returns the reading index per note line (or -1) and the readings left unpaired.
 */
export function pairReadings(noteLines: string[], readings: PlanReadingLine[]): { index: number[]; unpaired: PlanReadingLine[] } {
  const used = new Set<number>();
  const index = noteLines.map((line) => {
    const exact = readings.findIndex((r, i) => !used.has(i) && normalizeLine(r.line) === normalizeLine(line));
    const found = exact >= 0 ? exact : readings.findIndex((r, i) => !used.has(i) && lineKey(r.line) === lineKey(line));
    if (found >= 0) used.add(found);
    return found;
  });
  return { index, unpaired: readings.filter((_, i) => !used.has(i)) };
}
