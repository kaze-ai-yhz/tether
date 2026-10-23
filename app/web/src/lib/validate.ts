import type { ActingAs, CallScenario, ReviewDecision, RuleField } from './types';

// Input validation for the /api routes. Every value from a request is checked here before it
// reaches a Snowflake binding; messages are shown to the user as-is.

export type Validation<T> = { ok: true; value: T } | { ok: false; message: string };

export const REVIEW_DECISIONS: readonly ReviewDecision[] = ['APPROVED', 'EDITED', 'REJECTED'];
export const CALL_SCENARIOS: readonly CallScenario[] = ['ANSWERED', 'NO_ANSWER', 'CHEST_PAIN'];
export const RULE_FIELDS: readonly RuleField[] = ['threshold1', 'threshold2', 'window_days', 'min_readings'];
/** 0 = jump to the next ladder event. */
export const CLOCK_DAYS: readonly number[] = [0, 1, 2, 5, 10, 21];
export const MIN_REASON_LENGTH = 10;

const MAX_NOTE = 1000;
const MAX_EDITED_TEXT = 4000;
const MAX_REASON = 500;
const MAX_QUESTION = 300;
const MAX_RULE_VALUE = 100_000;

function ok<T>(value: T): Validation<T> {
  return { ok: true, value };
}

function fail<T>(message: string): Validation<T> {
  return { ok: false, message };
}

function isRecord(body: unknown): body is Record<string, unknown> {
  return typeof body === 'object' && body !== null && !Array.isArray(body);
}

/** Trimmed string, '' for null/undefined, null when the value is not a string. */
function text(value: unknown): string | null {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value.trim() : null;
}

export function parseActionId(raw: string): Validation<number> {
  if (!/^\d{1,12}$/.test(raw)) return fail('The action id must be a whole number.');
  const id = Number(raw);
  return id > 0 ? ok(id) : fail('The action id must be a whole number.');
}

export function parsePatientId(raw: string): Validation<string> {
  return /^SYN-\d{3}$/i.test(raw) ? ok(raw.toUpperCase()) : fail('The patient id must look like SYN-001.');
}

export function parseRuleId(raw: string): Validation<string> {
  return /^[A-Z0-9][A-Z0-9_-]{0,47}$/i.test(raw) ? ok(raw.toUpperCase()) : fail('That is not a valid rule id.');
}

/** 'all' reads every note (READ_AI_PLAN(NULL)). */
export function parseNoteId(raw: string): Validation<string | null> {
  if (raw.toLowerCase() === 'all') return ok(null);
  return /^[A-Z0-9][A-Z0-9_-]{0,63}$/i.test(raw) ? ok(raw) : fail('That is not a valid note id.');
}

export function parseSessionBody(body: unknown): Validation<ActingAs> {
  const value = isRecord(body) ? body.actingAs : undefined;
  return value === 'agent' || value === 'clinician'
    ? ok(value)
    : fail('Acting as must be agent or clinician.');
}

export interface ReviewInput {
  decision: ReviewDecision;
  note: string | null;
  editedText: string | null;
}

export function parseReviewBody(body: unknown): Validation<ReviewInput> {
  if (!isRecord(body)) return fail('Send a JSON body with a decision.');
  const decision = body.decision;
  if (typeof decision !== 'string' || !REVIEW_DECISIONS.includes(decision as ReviewDecision)) {
    return fail('The decision must be APPROVED, EDITED or REJECTED.');
  }
  const note = text(body.note);
  const editedText = text(body.editedText);
  if (note === null) return fail('The note must be text.');
  if (editedText === null) return fail('The edited text must be text.');
  if (note.length > MAX_NOTE) return fail(`Keep the note under ${MAX_NOTE} characters.`);
  if (decision === 'REJECTED' && note.length < MIN_REASON_LENGTH) {
    return fail(`A reason of at least ${MIN_REASON_LENGTH} characters is needed to reject a draft.`);
  }
  if (decision === 'EDITED') {
    if (!editedText) return fail('Add the edited text before approving an edit.');
    if (editedText.length > MAX_EDITED_TEXT) return fail(`Keep the edited text under ${MAX_EDITED_TEXT} characters.`);
  }
  return ok({
    decision: decision as ReviewDecision,
    note: note || null,
    editedText: decision === 'EDITED' ? editedText : null,
  });
}

export interface RuleEditInput {
  field: RuleField;
  value: number;
  reason: string;
}

function parseRuleValue(field: RuleField, raw: unknown): Validation<number> {
  const value = typeof raw === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(raw) ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isFinite(value)) return fail('The new value must be a number.');
  if (value < 0 || value > MAX_RULE_VALUE) return fail('The new value is out of range.');
  if ((field === 'window_days' || field === 'min_readings') && (!Number.isInteger(value) || value < 1)) {
    return fail(`${field} must be a whole number of 1 or more.`);
  }
  return ok(value);
}

/** Preview needs field and value; a saved edit also needs a reason. */
export function parseRuleEditBody(body: unknown, requireReason: boolean): Validation<RuleEditInput> {
  if (!isRecord(body)) return fail('Send a JSON body with field and value.');
  const field = body.field;
  if (typeof field !== 'string' || !RULE_FIELDS.includes(field as RuleField)) {
    return fail('The field must be threshold1, threshold2, window_days or min_readings.');
  }
  const value = parseRuleValue(field as RuleField, body.value);
  if (!value.ok) return value;
  const reason = text(body.reason);
  if (reason === null) return fail('The reason must be text.');
  if (requireReason && reason.length < MIN_REASON_LENGTH) {
    return fail(`A reason of at least ${MIN_REASON_LENGTH} characters is needed to change a rule.`);
  }
  if (reason.length > MAX_REASON) return fail(`Keep the reason under ${MAX_REASON} characters.`);
  return ok({ field: field as RuleField, value: value.value, reason });
}

export function parseClockBody(body: unknown): Validation<number> {
  const days = isRecord(body) ? body.days : undefined;
  return typeof days === 'number' && CLOCK_DAYS.includes(days)
    ? ok(days)
    : fail('Days must be one of 0 (next event), 1, 2, 5, 10 or 21.');
}

export function parseSimulateBody(body: unknown): Validation<CallScenario> {
  const scenario = isRecord(body) ? body.scenario : undefined;
  return typeof scenario === 'string' && CALL_SCENARIOS.includes(scenario as CallScenario)
    ? ok(scenario as CallScenario)
    : fail('The scenario must be ANSWERED, NO_ANSWER or CHEST_PAIN.');
}

export function parseAskBody(body: unknown): Validation<string> {
  const question = isRecord(body) ? text(body.question) : null;
  if (!question || question.length > MAX_QUESTION) {
    return fail(`Ask a question of 1 to ${MAX_QUESTION} characters.`);
  }
  return ok(question);
}
