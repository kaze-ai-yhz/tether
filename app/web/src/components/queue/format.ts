import type { ActionType, QueueCondition, QueueItem, Recipient, RuleRow } from "@/lib/types";

// Display helpers for the approval queue. Clinical numbers never live here: thresholds are read
// from V_RULES rows passed in by the page.

export const CONDITION_LABEL: Record<QueueCondition, string> = {
  HTN: "Hypertension",
  COPD: "COPD",
  T2DM: "Type 2 diabetes",
  PLAN: "AI Plan review",
};

export const RECIPIENT_LABEL: Record<Recipient, string> = {
  PATIENT: "Patient",
  PRESCRIBER: "Prescriber",
  CLINICIAN: "Clinician",
  NONE: "No one",
};

/** Where SEND_APPROVED delivers an approved draft (all adapters are simulated). */
export function channelHint(actionType: ActionType, recipient: Recipient): string {
  if (actionType === "URGENT_ALERT") return "Internal alert already sent to the clinician";
  if (actionType === "AI_CHECKIN_CALL") return "AI check-in call (simulated) after approval";
  if (actionType === "CARE_TEAM_CALL") return "Call brief for the care team after approval";
  if (recipient === "PATIENT") return "SMS to the patient (simulated) after approval";
  if (recipient === "PRESCRIBER") return "Message to the prescriber (simulated) after approval";
  if (recipient === "CLINICIAN") return "Clinician inbox after approval";
  return "Not sent";
}

/** Channel word for announcements, e.g. "sent by SMS (simulated)". */
export function channelWord(item: Pick<QueueItem, "action_type" | "recipient">, channel?: string | null): string {
  const c = channel ?? null;
  if (c === "SMS" || (!c && item.recipient === "PATIENT" && item.action_type !== "AI_CHECKIN_CALL")) return "sent by SMS (simulated)";
  if (c === "AI_CALL" || (!c && item.action_type === "AI_CHECKIN_CALL")) return "AI check-in call queued (simulated)";
  if (c === "PRESCRIBER" || (!c && item.recipient === "PRESCRIBER")) return "sent to the prescriber (simulated)";
  if (c === "INTERNAL_ALERT") return "internal alert on record";
  return "sent to the clinician inbox (simulated)";
}

const PREF_LABEL: Record<string, string> = {
  LANGUAGE: "Language",
  CONTACT_WINDOW: "Contact window",
  DO_NOT_CONTACT: "Do not contact",
  CHECKINS: "Check-ins",
  REMINDER_CHANNEL: "Reminders",
  NOTIFY_IF: "Notify clinician if",
  AI_CALLS: "AI calls",
};

export interface Pref {
  key: string;
  label: string;
  value: string;
}

/** "LANGUAGE: Vietnamese; CONTACT_WINDOW: afternoons" -> [{label: "Language", value: "Vietnamese"}, ...]. */
export function parsePrefs(prefs: string | null | undefined): Pref[] {
  if (!prefs) return [];
  return prefs
    .split(/;\s+/)
    .map((part) => {
      const at = part.indexOf(":");
      if (at < 0) return { key: part.trim(), label: part.trim(), value: "" };
      const key = part.slice(0, at).trim();
      return { key, label: PREF_LABEL[key] ?? key, value: part.slice(at + 1).trim() };
    })
    .filter((p) => p.label);
}

export type PlanLineStatus = "SAFETY_BLOCKED" | "NEEDS_CONFIRMATION" | "UNRECOGNIZED";

export const PLAN_STATUS_LABEL: Record<PlanLineStatus, string> = {
  SAFETY_BLOCKED: "Safety blocked",
  NEEDS_CONFIRMATION: "Needs confirmation",
  UNRECOGNIZED: "Not recognized",
};

/** PLAN-REVIEW evidence (Faiz's view): 'Note N-015 (2026-10-01): "- Red flag BP: ..." was SAFETY_BLOCKED; ...'. */
export function planLineFromEvidence(evidence: string): { noteId: string | null; line: string; status: PlanLineStatus | null; tail: string } | null {
  const m = /^Note (\S+) \(([^)]*)\): "([\s\S]*)" was (SAFETY_BLOCKED|NEEDS_CONFIRMATION|UNRECOGNIZED)(?:; ([\s\S]*))?$/.exec(evidence);
  if (!m) return null;
  return { noteId: m[1], line: m[3].replace(/^- /, ""), status: m[4] as PlanLineStatus, tail: m[5] ?? "" };
}

export interface ReadingSeries {
  readingType: string;
  unit: string;
  /** Threshold value from a V_RULES row, with its text label. */
  threshold: number | null;
  thresholdLabel?: string;
}

const UNIT: Record<string, string> = { BP: "mmHg", SPO2: "%", GLUCOSE: "mg/dL", A1C: "%" };

/** Rules whose threshold1 is a reading value, and how the rule compares against it. */
const READING_RULES: Record<string, { op: string; readingType: string }> = {
  "BP-RED": { op: "≥", readingType: "BP" },
  "BP-1": { op: "≥", readingType: "BP" },
  "BP-3": { op: "≥", readingType: "BP" },
  "BP-GOAL": { op: "≥", readingType: "BP" },
  "COPD-3": { op: "≤", readingType: "SPO2" },
  "DM-RED": { op: "<", readingType: "GLUCOSE" },
  "DM-3": { op: "<", readingType: "GLUCOSE" },
};

/** Default reference line per reading type when the firing rule has no reading threshold (e.g. ladder rules). */
const REFERENCE_RULE: Record<string, string> = { BP: "BP-GOAL", SPO2: "COPD-3", GLUCOSE: "DM-RED" };

export function seriesFor(item: QueueItem, rules: Record<string, Pick<RuleRow, "threshold1">>): ReadingSeries | null {
  const readingType = item.recent_readings[0]?.reading_type;
  if (!readingType) return null;
  const own = READING_RULES[item.rule_id]?.readingType === readingType ? item.rule_id : REFERENCE_RULE[readingType];
  const spec = own ? READING_RULES[own] : undefined;
  const value = own ? rules[own]?.threshold1 ?? null : null;
  return {
    readingType,
    unit: UNIT[readingType] ?? "",
    threshold: spec && value != null ? value : null,
    thresholdLabel: spec && value != null ? `${own} ${spec.op} ${value}${readingType === "SPO2" ? " %" : ""}` : undefined,
  };
}

export const READING_LABEL: Record<string, string> = {
  BP: "home BP",
  SPO2: "resting SpO2",
  GLUCOSE: "home glucose",
  A1C: "A1C",
};
