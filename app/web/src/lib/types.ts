// Row contracts for the Tether app views in CARE_RULES.CORE (plan §3.2 as revised by REVISION 1
// and 2: Faiz's CLINICAL_NOTES / V_PATIENT_OVERRIDES base), proc results (§3.3) and the JSON
// envelope every /api route returns. Keys are lower-case column names. Dates are 'YYYY-MM-DD'
// strings and timestamps ISO strings: the views format them as VARCHAR.

export type ActingAs = 'agent' | 'clinician';

export type Condition = 'HTN' | 'COPD' | 'T2DM';
/** PLAN = a PLAN-REVIEW item for an AI Plan line that was not applied. */
export type QueueCondition = Condition | 'PLAN';
export type RuleCondition = Condition | 'ALL' | 'PLAN';
/** P0 = RULES default; P2 = changed by an applied AI Plan override (shown as "P2 · AI Plan"). */
export type Layer = 'P0' | 'P1' | 'P2';
export type Recipient = 'PATIENT' | 'PRESCRIBER' | 'CLINICIAN' | 'NONE';

/** RULES.action_type values in Faiz's file. */
export type ActionType =
  | 'READING_REMINDER'
  | 'BARRIER_CHECKIN'
  | 'AI_CHECKIN_CALL'
  | 'CARE_TEAM_CALL'
  | 'LOST_TO_FOLLOWUP'
  | 'RECOMMEND_DEVICE'
  | 'ADHERENCE_CHECKIN'
  | 'LAB_REMINDER'
  | 'RECOMMEND_START'
  | 'RECOMMEND_TITRATE'
  | 'RECOMMEND_REVIEW'
  | 'RECOMMEND_O2_EVAL'
  | 'RECOMMEND_INTENSIFY'
  | 'URGENT_ALERT'
  | 'HELD_BY_CLINICIAN'
  | 'PLAN_REVIEW'
  | 'NONE';

export type ActionStatus = 'PENDING' | 'APPROVED' | 'EDITED' | 'REJECTED' | 'SENT';
export type ReviewDecision = 'APPROVED' | 'EDITED' | 'REJECTED';
export type DraftSource = 'CLAUDE' | 'TEMPLATE' | 'RULE' | 'FAIZ';
export type ActionKind = 'DRAFT' | 'RED_FLAG' | 'PLAN_REVIEW' | 'CALL_RETRY' | 'CALL_ESCALATION' | 'CALL_HANDOFF';
export type Rung = 'ENG-1' | 'ENG-2' | 'ENG-3' | 'ENG-3H' | 'ENG-4' | 'ENG-DEV';
export type RolesMode = 'REAL' | 'SIMULATED';

/** Display status words, exactly as V_PATIENT_LIST emits them (DATA-MODEL §4). */
export type DisplayStatus =
  | 'Needs clinician'
  | 'Awaiting approval'
  | 'Action taken'
  | 'Pending'
  | 'Ongoing follow-up'
  | 'Complete'
  | 'Scheduled'
  | 'Visited · no AI Plan';

/** Custom = at least one APPLIED AI Plan override. */
export type AiPlanMode = 'Standard' | 'Custom';
/** NEEDS_REVIEW = some AI Plan line was not applied. */
export type PlanStatus = 'ACTIVE' | 'NEEDS_REVIEW' | 'REJECTED' | 'CLOSED';
export type TodoKind = 'COLLECT' | 'WATCH' | 'REVIEW' | 'LIFESTYLE';
export type OutboxChannel = 'SMS' | 'AI_CALL' | 'PRESCRIBER' | 'PHARMACY' | 'CLINICIAN' | 'INTERNAL_ALERT';
export type CallScenario = 'ANSWERED' | 'NO_ANSWER' | 'CHEST_PAIN';
export type CallOutcome = 'ANSWERED' | 'NO_ANSWER' | 'HANDOFF' | 'ID_FAILED';
export type RuleField = 'threshold1' | 'threshold2' | 'window_days' | 'min_readings';
export type ReadingType = 'BP' | 'SPO2' | 'A1C' | 'GLUCOSE' | 'EXACERBATION' | 'ADHERENCE' | 'BARRIER';

/** Faiz's V_PATIENT_OVERRIDES.status. */
export type OverrideStatus = 'APPLIED' | 'SAFETY_BLOCKED' | 'NEEDS_CONFIRMATION' | 'UNRECOGNIZED';
/** Faiz's OVERRIDE_KEYS.setting values. */
export type OverrideSetting =
  | 'A1C_GOAL'
  | 'BP_GOAL'
  | 'HOLD_ESCALATION_UNTIL'
  | 'AI_CALLS'
  | 'CONTACT_WINDOW'
  | 'LANGUAGE'
  | 'DO_NOT_CONTACT'
  | 'CHECKINS'
  | 'REMINDER_CHANNEL'
  | 'NOTIFY_IF';

// ---------------------------------------------------------------------------------------------
// V_APP_STATE
// ---------------------------------------------------------------------------------------------

export interface CallReady {
  action_id: number;
  patient_id: string;
}

export interface AppState {
  as_of_date: string; // simulated clock
  pending_count: number;
  red_flag_count: number;
  needs_clinician_count: number;
  roles_mode: RolesMode;
  /** Model ids from TETHER_SETTINGS (keys as the view emits them). */
  models: Record<string, string>;
  /** SENT AI check-in calls that can be simulated now. */
  call_ready: CallReady[];
}

// ---------------------------------------------------------------------------------------------
// V_QUEUE (PENDING drafts only) and V_HELD
// ---------------------------------------------------------------------------------------------

export interface RecentReading {
  taken_on: string;
  value1: number | null;
  value2: number | null;
  reading_type: ReadingType;
}

export interface QueueItem {
  action_id: number;
  patient_id: string;
  display_name: string;
  condition: QueueCondition;
  rule_id: string;
  /** Rule the patient is at now; differs from rule_id when the draft is stale. */
  current_rule_id: string | null;
  stale: boolean;
  kind: ActionKind;
  step: string;
  action_type: ActionType;
  recipient: Recipient;
  priority: number;
  layer: Layer;
  citation: string;
  evidence: string;
  /** Contact preferences from the AI Plan, e.g. 'LANGUAGE: Vietnamese'. */
  patient_prefs: string | null;
  /** Note whose applied AI Plan line changed this firing (P2), else null. */
  override_note_id: string | null;
  /** Full draft including the Why: line. */
  draft_text: string;
  /** Draft text before the Why: line. */
  draft_body: string;
  why_text: string | null;
  status: 'PENDING';
  created_at: string;
  sim_date: string | null;
  model: string | null;
  draft_source: DraftSource | null;
  safety_ok: boolean | null;
  safety_notes: string | null;
  is_red_flag: boolean;
  /** True for READING_REMINDER drafts, the only kind that may be batch-approved. */
  batchable: boolean;
  ai_call_consent: boolean | null;
  /** Last 14 readings of the relevant type, oldest first. */
  recent_readings: RecentReading[];
}

/** V_HELD: firings a clinician held (rule HOLD). Not drafts; never sendable. */
export interface HeldItem {
  patient_id: string;
  display_name: string;
  condition: Condition;
  held_rule: string;
  held_until: string;
  note_id: string;
  evidence: string;
}

export interface QueueBundle {
  items: QueueItem[];
  held: HeldItem[];
}

// ---------------------------------------------------------------------------------------------
// V_PATIENT_LIST
// ---------------------------------------------------------------------------------------------

export interface PatientListRow {
  patient_id: string;
  display_name: string;
  age: number | null;
  conditions: Condition[];
  ai_plan_mode: AiPlanMode | null;
  plan_status: PlanStatus | null;
  todos_done: number;
  todos_total: number;
  current_rule_id: string | null;
  current_step: string | null;
  rung: Rung | null;
  display_status: DisplayStatus;
  /** 1 = most severe (Needs clinician). */
  status_rank: number;
  status_reason: string | null;
  next_visit_on: string | null;
  last_reading_on: string | null;
  pending_count: number;
  /** Contact preferences from the AI Plan. */
  prefs: string | null;
  held_until: string | null;
}

// ---------------------------------------------------------------------------------------------
// V_PATIENT_DETAIL (one row per patient; nested OBJECT / ARRAY columns)
// ---------------------------------------------------------------------------------------------

/** Faiz's CLINICAL_NOTES, oldest first. */
export interface ClinicalNote {
  note_id: string;
  note_date: string;
  clinician: string;
  note_text: string;
  has_ai_plan: boolean;
}

/** One AI Plan line as Faiz's V_PATIENT_OVERRIDES parsed it (code decides the status). */
export interface OverrideLine {
  note_id: string;
  note_date: string;
  line: string;
  raw_key: string;
  raw_value: string;
  setting: OverrideSetting | null;
  status: OverrideStatus;
}

/** V_ACTIVE_OVERRIDES: the latest signed, applied line per setting. */
export interface ActiveOverride {
  setting: OverrideSetting;
  raw_value: string;
  note_id: string;
}

/** Claude's plain-language reading of one AI Plan line. It explains; it does not decide. */
export interface PlanReadingLine {
  line: string;
  meaning: string;
  concern: string | null;
}

export interface PlanReading {
  summary: string;
  lines: PlanReadingLine[];
}

export interface PlanValidation {
  ok?: boolean;
  reasons?: string[];
  [key: string]: unknown;
}

export interface CarePlan {
  plan_id: string;
  condition: Condition;
  note_id: string | null;
  mode: AiPlanMode;
  status: PlanStatus;
  /** null until READ_AI_PLAN has run for the note. */
  reading: PlanReading | null;
  reading_model: string | null;
  validation: PlanValidation | null;
}

export interface HeldInfo {
  held_rule: string;
  held_until: string;
  note_id: string;
}

export interface Todo {
  todo_id: string;
  plan_id: string;
  seq: number;
  todo_text: string;
  rule_id: string | null;
  /** Override setting behind a P2 todo. */
  setting: OverrideSetting | null;
  layer: Layer;
  due_on: string | null;
  done: boolean;
  kind: TodoKind;
}

/** Table 2 row (V_MONITORED_VALUES). */
export interface MonitoredValue {
  patient_id: string;
  condition: Condition;
  reading_type: ReadingType;
  resource: string;
  cadence_days: number | null;
  cadence_rule_id: string | null;
  layer: Layer;
  /** Display text, e.g. '136/84', '88 %', '6.6 %', '51 mg/dL'. */
  last_value: string | null;
  last_on: string | null;
  days_since: number | null;
  days_overdue: number | null;
  collect_flag: boolean;
  action_flag: boolean;
  rung: Rung | null;
  /** True when the patient has no working device for this reading. */
  paused: boolean;
  note: string | null;
}

export interface OutboxSend {
  msg_id: number;
  channel: OutboxChannel;
  recipient: string | null;
  payload: string;
  provider: string;
  sent_at: string;
  sent_sim: string | null;
}

export interface PatientAction {
  action_id: number;
  condition: QueueCondition;
  rule_id: string;
  kind: ActionKind | null;
  step: string | null;
  action_type: ActionType | null;
  recipient: Recipient;
  layer: Layer | null;
  evidence: string;
  draft_text: string;
  status: ActionStatus;
  /** OUTBOX channel once sent. */
  channel: OutboxChannel | null;
  created_at: string;
  sim_date: string | null;
  model: string | null;
  draft_source: DraftSource | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  sends: OutboxSend[];
}

export interface CallTranscript {
  call_id: number;
  action_id: number;
  attempt: number;
  outcome: CallOutcome;
  /** Simulated transcript text (always labelled simulated in the UI). */
  transcript: string;
  answers: Record<string, unknown> | null;
  rule_id: string | null;
  at_sim: string | null;
  scenario: CallScenario | null;
  model: string | null;
}

/** V_FIRINGS row: Faiz's V_RULE_FIRINGS columns plus Tether flags. */
export interface Firing {
  patient_id: string;
  condition: QueueCondition;
  rule_id: string;
  step: string;
  action_type: ActionType;
  recipient: Recipient;
  priority: number;
  evidence: string;
  citation: string;
  patient_prefs: string | null;
  layer: Layer;
  override_note_id: string | null;
  is_red_flag: boolean;
  is_held: boolean;
  /** Rule that would have fired without the hold, e.g. DM-2. */
  held_rule: string | null;
}

export interface PatientDetail extends PatientListRow {
  has_diabetes: boolean | null;
  has_ckd: boolean | null;
  has_clinical_cvd: boolean | null;
  prevent_10yr_pct: number | null;
  a1c_goal: number | null;
  doctor_id: string | null;
  ai_call_consent: boolean | null;
  notes: ClinicalNote[];
  overrides: OverrideLine[];
  active_overrides: ActiveOverride[];
  plan: CarePlan | null;
  held: HeldInfo | null;
  todos: Todo[];
  monitored: MonitoredValue[];
  actions: PatientAction[];
  calls: CallTranscript[];
  firings: Firing[];
}

// ---------------------------------------------------------------------------------------------
// V_TIMELINE
// ---------------------------------------------------------------------------------------------

export interface TimelineEvent {
  patient_id: string;
  logged_at: string;
  actor: string;
  event: string;
  action_id: number | null;
  detail: string | null;
}

// ---------------------------------------------------------------------------------------------
// Rules tab: V_RULES, RULE_EDITS, Faiz's OVERRIDE_KEYS and SAFETY_LOCKED_TERMS
// ---------------------------------------------------------------------------------------------

export interface RuleEdit {
  edit_id: number;
  rule_id: string;
  field: RuleField;
  old_value: string | null;
  new_value: string | null;
  reason: string;
  edited_by: string;
  edited_at: string;
  impact: unknown;
}

export interface RuleRow {
  rule_id: string;
  condition: RuleCondition;
  step: string;
  threshold1: number | null;
  threshold2: number | null;
  window_days: number | null;
  min_readings: number | null;
  priority: number;
  action_type: ActionType;
  recipient: Recipient;
  citation: string;
  is_red_flag: boolean;
  /** True for rows whose value Faiz still has to set (citation starts with PLACEHOLDER). */
  is_placeholder: boolean;
  editable_fields: RuleField[];
  last_edit: Omit<RuleEdit, 'edit_id' | 'rule_id' | 'impact'> | null;
  firing_count: number;
}

/** Faiz's OVERRIDE_KEYS: the AI Plan keys and their accepted ranges (read-only). */
export interface OverrideKey {
  key_prefix: string;
  setting: OverrideSetting;
  value_type: 'NUM' | 'BP' | 'DATE' | 'YESNO' | 'TEXT';
  min_value: number | null;
  max_value: number | null;
  min_value2: number | null;
  max_value2: number | null;
  max_days: number | null;
  description: string;
}

export interface RulesBundle {
  rules: RuleRow[];
  /** Newest first. */
  edits: RuleEdit[];
  override_keys: OverrideKey[];
  /** Words that block an AI Plan line (Faiz's SAFETY_LOCKED_TERMS). */
  safety_locked_terms: string[];
}

// ---------------------------------------------------------------------------------------------
// Proc results (VARIANT JSON {ok, message, ...})
// ---------------------------------------------------------------------------------------------

export interface ProcResult {
  ok: boolean;
  message: string;
  /** Set by the data layer when no Snowflake call was made. */
  fixtures?: boolean;
  [key: string]: unknown;
}

export interface ReviewResult extends ProcResult {
  action_id?: number;
  status?: ActionStatus;
  channel?: OutboxChannel;
}

export interface FiringChange {
  patient_id: string;
  condition: QueueCondition;
  /** Rule id (or null) firing before and after the edit. */
  before: string | null;
  after: string | null;
}

export interface RuleEditResult extends ProcResult {
  rule_id?: string;
  field?: RuleField;
  old_value?: number | string | null;
  new_value?: number | string | null;
  changed?: FiringChange[];
}

export interface ClockResult extends ProcResult {
  as_of_date?: string;
  drafts_created?: number;
}

export interface CallResult extends ProcResult {
  call_id?: number;
  outcome?: CallOutcome;
}

export interface AskAnswer {
  question: string;
  /** Recorded ASK_CACHE answer (VARIANT); null when none is recorded for this question. */
  answer: unknown;
  /** Always 'recorded' until a live agent is wired in. */
  source: 'recorded';
  message: string | null;
}

export interface SessionInfo {
  acting_as: ActingAs;
}

// ---------------------------------------------------------------------------------------------
// Results and the API envelope
// ---------------------------------------------------------------------------------------------

export type ErrorCode =
  | 'BAD_REQUEST' // input failed validation (HTTP 400)
  | 'NOT_FOUND' // no such patient / row (HTTP 404)
  | 'DECLINED' // a proc ran and returned ok:false (HTTP 409); detail = proc result
  | 'SNOWFLAKE_REFUSED' // Snowflake refused for lack of privilege (HTTP 403)
  | 'SNOWFLAKE_ERROR' // any other Snowflake or network failure (HTTP 502)
  | 'TIMEOUT'; // still running after the wait limit (HTTP 504)

export interface ApiError {
  code: ErrorCode;
  message: string;
  sql_state?: string | null;
  detail?: unknown;
}

export type Result<T, E = ApiError> = { ok: true; data: T } | { ok: false; error: E };

/**
 * What the data layer returns: a Result, whether fixtures served it, and (fixtures only) the
 * fixture file's _source: 'sample' for hand-made data, '<view> @ <ts>' for a live export.
 */
export type DataResult<T> = Result<T> & { fixtures: boolean; fixture_source?: string };

/** JSON body of every /api route. */
export type ApiResponse<T> = DataResult<T> & { acting_as: ActingAs };
