import type { OverrideKey, RuleField, RuleRow } from "@/lib/types";
import { RULE_FIELDS } from "@/lib/validate";
import { formatSimDate } from "../format";

// Pure helpers for the rules tab: grouping, value formatting and reading the V_RULE_FIRINGS
// impact that PREVIEW_RULE_EDIT, UPDATE_RULE and RULE_EDITS.impact return. Every number shown
// comes from a row or a proc result; nothing here supplies a clinical value.

export interface RuleGroupData {
  /** RULES.condition, e.g. HTN. */
  condition: string;
  label: string;
  /** Element id of the group section, for the jump links. */
  anchor: string;
  rules: RuleRow[];
}

/** Condition groups in display order. Unknown conditions follow, by name. */
const GROUPS: ReadonlyArray<{ condition: string; label: string }> = [
  { condition: "HTN", label: "Hypertension" },
  { condition: "COPD", label: "COPD" },
  { condition: "T2DM", label: "Type 2 diabetes" },
  { condition: "ALL", label: "All conditions" },
  { condition: "PLAN", label: "AI Plan" },
];

function byPriority(a: RuleRow, b: RuleRow): number {
  const pa = toNumber(a.priority);
  const pb = toNumber(b.priority);
  if (pa !== pb) {
    if (pa === null) return 1;
    if (pb === null) return -1;
    return pa - pb;
  }
  return a.rule_id.localeCompare(b.rule_id);
}

export function groupRules(rules: RuleRow[]): RuleGroupData[] {
  const buckets = new Map<string, RuleRow[]>();
  for (const rule of rules) {
    const condition = String(rule.condition ?? "").toUpperCase() || "OTHER";
    const bucket = buckets.get(condition);
    if (bucket) bucket.push(rule);
    else buckets.set(condition, [rule]);
  }
  const known = GROUPS.filter((g) => buckets.has(g.condition));
  const unknown = [...buckets.keys()]
    .filter((c) => !GROUPS.some((g) => g.condition === c))
    .sort()
    .map((c) => ({ condition: c, label: c }));
  return [...known, ...unknown].map(({ condition, label }) => ({
    condition,
    label,
    anchor: `rules-${condition.toLowerCase()}`,
    rules: [...(buckets.get(condition) ?? [])].sort(byPriority),
  }));
}

export const FIELD_LABEL: Record<RuleField, string> = {
  threshold1: "Threshold 1",
  threshold2: "Threshold 2",
  window_days: "Window (days)",
  min_readings: "Min readings",
};

export function fieldLabel(field: string): string {
  return (FIELD_LABEL as Record<string, string>)[field] ?? field;
}

const RECIPIENT_LABEL: Record<string, string> = {
  PATIENT: "Patient",
  PRESCRIBER: "Prescriber",
  CLINICIAN: "Clinician",
};

/** "to Clinician", or "no recipient" for NONE (parameter rows and holds). */
export function recipientPhrase(recipient: string | null | undefined): string {
  if (!recipient || recipient.toUpperCase() === "NONE") return "no recipient";
  return `to ${RECIPIENT_LABEL[recipient.toUpperCase()] ?? recipient}`;
}

export function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && /^\s*-?\d+(\.\d+)?\s*$/.test(value)) return Number(value);
  return null;
}

/** 88 -> "88", 7.5 -> "7.5", "88.0" -> "88". Null when there is no value. */
export function formatValue(value: unknown): string | null {
  const n = toNumber(value);
  if (n === null) return typeof value === "string" && value.trim() ? value.trim() : null;
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
}

/** The fields V_RULES lets a clinician change for this rule, in RULE_FIELDS order. */
export function editableFields(rule: RuleRow): RuleField[] {
  const listed = new Set((rule.editable_fields ?? []).map((f) => String(f).toLowerCase()));
  return RULE_FIELDS.filter((f) => listed.has(f));
}

export function isPlaceholderRule(rule: RuleRow): boolean {
  return rule.is_placeholder === true || (rule.citation ?? "").trim().startsWith("PLACEHOLDER");
}

/** Citation text after its source, e.g. "GOLD 2026: evaluate LTOT …" -> "evaluate LTOT …". */
export function citationDetail(citation: string | null | undefined): string | null {
  if (!citation) return null;
  const index = citation.indexOf(":");
  if (index < 0) return null;
  const rest = citation.slice(index + 1).trim();
  return rest || null;
}

export function firesPhrase(count: number): string {
  return `fires for ${count} ${count === 1 ? "patient" : "patients"} now`;
}

/** "1 patient changes" (preview) or "2 patients changed" (saved edit). */
export function patientsChangePhrase(count: number, tense: "preview" | "saved"): string {
  if (tense === "saved") return `${count} ${count === 1 ? "patient" : "patients"} changed`;
  return `${count} ${count === 1 ? "patient changes" : "patients change"}`;
}

/** "2026-10-23T14:05:12.000Z" -> "Oct 23, 2026 14:05" (string parse, no time zone shift). */
export function formatTimestamp(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/.exec(iso);
  if (!match) return formatSimDate(iso);
  return `${formatSimDate(match[1])} ${match[2]}:${match[3]}`;
}

/** Accepted values for an AI Plan key, as Faiz's V_PATIENT_OVERRIDES checks them. */
export function acceptedRange(key: OverrideKey): string {
  const span = (low: unknown, high: unknown): string | null => {
    const a = formatValue(low);
    const b = formatValue(high);
    if (a && b) return `${a}–${b}`;
    if (a) return `${a} or more`;
    if (b) return `up to ${b}`;
    return null;
  };
  switch (String(key.value_type).toUpperCase()) {
    case "NUM":
      return span(key.min_value, key.max_value) ?? "—";
    case "BP": {
      const systolic = span(key.min_value, key.max_value);
      const diastolic = span(key.min_value2, key.max_value2);
      return systolic && diastolic ? `${systolic} / ${diastolic}` : (systolic ?? diastolic ?? "—");
    }
    case "DATE": {
      const days = formatValue(key.max_days);
      return days ? `Up to ${days} days after the note` : "—";
    }
    case "YESNO":
      return "yes, allowed or no";
    case "TEXT":
      return "Free text";
    default:
      return "—";
  }
}

// ---------------------------------------------------------------------------------------------
// V_RULE_FIRINGS impact
// ---------------------------------------------------------------------------------------------

export interface FiringChangeView {
  patientId: string;
  condition: string | null;
  /** Rule id firing before / after the edit; null = nothing fired. */
  before: string | null;
  after: string | null;
}

export interface ImpactView {
  /** Patients whose firing changed, as reported (or the distinct patients in the list). */
  count: number;
  changes: FiringChangeView[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads a key case-insensitively: OBJECT_CONSTRUCT(*) yields upper-case keys. */
function pick(obj: Record<string, unknown>, key: string): unknown {
  if (key in obj) return obj[key];
  const lower = key.toLowerCase();
  for (const [k, v] of Object.entries(obj)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

function parseIfJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function ruleIdOf(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (isRecord(value)) return ruleIdOf(pick(value, "rule_id"));
  return null;
}

function toChange(item: Record<string, unknown>): FiringChangeView {
  const condition = pick(item, "condition");
  return {
    patientId: String(pick(item, "patient_id") ?? "—"),
    condition: typeof condition === "string" ? condition : null,
    before: ruleIdOf(pick(item, "before") ?? pick(item, "before_rule_id")),
    after: ruleIdOf(pick(item, "after") ?? pick(item, "after_rule_id")),
  };
}

/**
 * The changed V_RULE_FIRINGS rows in a proc result ({changed_count?, changed: [...]}) or in
 * RULE_EDITS.impact (the same object, or the bare list). Null when the source has no impact.
 */
export function readImpact(source: unknown): ImpactView | null {
  const value = parseIfJson(source);
  let list: unknown = null;
  let reported: number | null = null;
  if (Array.isArray(value)) {
    list = value;
  } else if (isRecord(value)) {
    list = parseIfJson(pick(value, "changed") ?? pick(value, "changes") ?? null);
    reported = toNumber(pick(value, "changed_count"));
  } else {
    return null;
  }
  const changes = Array.isArray(list) ? list.filter(isRecord).map(toChange) : [];
  if (reported !== null) return { count: reported, changes };
  if (!Array.isArray(list)) return null;
  return { count: new Set(changes.map((c) => c.patientId)).size, changes };
}
