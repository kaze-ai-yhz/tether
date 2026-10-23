import 'server-only';

import askCacheFixture from '@/fixtures/ask_cache.json';
import overrideKeysFixture from '@/fixtures/override_keys.json';
import ruleEditsFixture from '@/fixtures/rule_edits.json';
import safetyLockedTermsFixture from '@/fixtures/safety_locked_terms.json';
import appStateFixture from '@/fixtures/v_app_state.json';
import heldFixture from '@/fixtures/v_held.json';
import patientDetailFixture from '@/fixtures/v_patient_detail.json';
import patientListFixture from '@/fixtures/v_patient_list.json';
import queueFixture from '@/fixtures/v_queue.json';
import rulesFixture from '@/fixtures/v_rules.json';
import timelineFixture from '@/fixtures/v_timeline.json';

import { effectiveMode, getEnv, type EffectiveMode } from './env';
import { getActingAs } from './session';
import { buildCall, execute, type Bind, type Row, type SnowflakeFailure } from './snowflake';
import type {
  ActingAs,
  AppState,
  AskAnswer,
  CallResult,
  CallScenario,
  ClockResult,
  DataResult,
  HeldItem,
  OverrideKey,
  PatientDetail,
  PatientListRow,
  ProcResult,
  QueueBundle,
  QueueItem,
  ReviewDecision,
  ReviewResult,
  RuleEdit,
  RuleEditResult,
  RuleField,
  RuleRow,
  RulesBundle,
  TimelineEvent,
} from './types';

// Data layer for the app. Live mode reads the app views and calls the Tether procs through the
// SQL API as the acting role; fixtures mode serves src/fixtures/*.json and never writes.
// Fixture files are {"_source": "...", "rows": [...]} ("sample" = hand-made, not from Snowflake).

const READ_WAIT_SECONDS = 60;
const CALL_WAIT_SECONDS = 150;

/** Procs only CLINICIAN_ROLE may use (plan decision 9). Fixtures mode mirrors the refusal. */
const CLINICIAN_ONLY = new Set(['TETHER_REVIEW', 'UPDATE_RULE', 'PREVIEW_RULE_EDIT', 'DEMO_RESET']);

// ---------------------------------------------------------------------------------------------
// Row normalization (live rows and fixtures alike)
// ---------------------------------------------------------------------------------------------

const JSON_COLUMNS = new Set([
  'models', 'call_ready', 'recent_readings', 'conditions', 'notes', 'overrides', 'active_overrides',
  'plan', 'held', 'todos', 'monitored', 'actions', 'calls', 'firings', 'editable_fields', 'last_edit',
  'impact', 'answer',
]);
const ARRAY_COLUMNS = new Set([
  'call_ready', 'recent_readings', 'conditions', 'notes', 'overrides', 'active_overrides', 'todos',
  'monitored', 'actions', 'calls', 'firings', 'editable_fields',
]);

function parseMaybeJson(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function toArray(key: string, value: unknown): unknown[] {
  if (value === null || value === undefined || value === '') return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && key === 'conditions') return value.split(',').map((s) => s.trim()).filter(Boolean);
  return [value];
}

/** Lower-case keys, parse JSON text in VARIANT columns, and make list columns arrays. */
function normalizeRow<T>(input: Row): T {
  const row: Row = {};
  for (const [rawKey, rawValue] of Object.entries(input)) {
    const key = rawKey.toLowerCase();
    if (key === '_source') continue;
    let value = typeof rawValue === 'string' && JSON_COLUMNS.has(key) ? parseMaybeJson(rawValue) : rawValue;
    if (ARRAY_COLUMNS.has(key)) value = toArray(key, value);
    row[key] = value;
  }
  return row as T;
}

interface FixtureSet<T> {
  rows: T[];
  source: string;
}

/** Accepts {"_source", "rows"} or a bare array of rows (e.g. a raw export). */
function fixture<T>(file: unknown): FixtureSet<T> {
  const wrapped = !Array.isArray(file) && typeof file === 'object' && file !== null;
  const rows = (wrapped ? (file as { rows?: unknown }).rows : file) ?? [];
  const list = Array.isArray(rows) ? rows : [rows];
  const first = list[0] as Row | undefined;
  const source = (wrapped ? (file as { _source?: unknown })._source : first?._source) ?? 'unknown';
  return { rows: list.map((r) => normalizeRow<T>(r as Row)), source: String(source) };
}

// ---------------------------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------------------------

async function modeFor(actingAs?: ActingAs): Promise<{ actingAs: ActingAs; mode: EffectiveMode }> {
  const who = actingAs ?? (await getActingAs());
  return { actingAs: who, mode: effectiveMode(who) };
}

function fromFailure<T>(failure: SnowflakeFailure): DataResult<T> {
  return {
    ok: false,
    error: { code: failure.code, message: failure.message, sql_state: failure.sqlState },
    fixtures: false,
  };
}

async function readRows<T>(
  actingAs: ActingAs | undefined,
  statement: string,
  binds: Bind[],
  fromFixture: () => FixtureSet<T>,
): Promise<DataResult<T[]>> {
  const { mode } = await modeFor(actingAs);
  if (mode.mode === 'fixtures') {
    const set = fromFixture();
    return { ok: true, data: set.rows, fixtures: true, fixture_source: set.source };
  }
  const result = await execute<Row>(mode.credentials, statement, binds, { waitSeconds: READ_WAIT_SECONDS });
  if (!result.ok) return fromFailure(result);
  return { ok: true, data: result.rows.map((r) => normalizeRow<T>(r)), fixtures: false };
}

function firstRow<T>(result: DataResult<T[]>, notFound: string): DataResult<T> {
  if (!result.ok) return result;
  const [row] = result.data;
  if (!row) {
    return { ok: false, error: { code: 'NOT_FOUND', message: notFound }, fixtures: result.fixtures, fixture_source: result.fixture_source };
  }
  return { ok: true, data: row, fixtures: result.fixtures, fixture_source: result.fixture_source };
}

/** A CALL returns one row with one VARIANT column named after the proc: {ok, message, ...}. */
function toProcResult(rows: Row[]): ProcResult {
  const value = rows[0] ? Object.values(rows[0])[0] : null;
  const parsed = typeof value === 'string' ? parseMaybeJson(value) : value;
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    return { ...obj, ok: obj.ok !== false, message: typeof obj.message === 'string' ? obj.message : '' };
  }
  if (typeof parsed === 'string') return { ok: true, message: parsed };
  return { ok: false, message: 'The procedure returned no result.' };
}

async function callProc<T extends ProcResult>(
  actingAs: ActingAs | undefined,
  name: string,
  args: (Bind | null)[],
  fixtureResult: (actingAs: ActingAs) => Omit<T, 'ok' | 'fixtures'>,
): Promise<DataResult<T>> {
  const { actingAs: who, mode } = await modeFor(actingAs);
  if (mode.mode === 'fixtures') {
    if (who === 'agent' && CLINICIAN_ONLY.has(name)) {
      return {
        ok: false,
        error: {
          code: 'SNOWFLAKE_REFUSED',
          message: `Fixture mode (simulated): ${getEnv().roleAgent} has no USAGE on ${name}. In live mode Snowflake itself refuses this call.`,
          sql_state: null,
        },
        fixtures: true,
      };
    }
    return { ok: true, data: { ...fixtureResult(who), ok: true, fixtures: true } as T, fixtures: true };
  }
  const { statement, binds } = buildCall(name, args);
  const result = await execute<Row>(mode.credentials, statement, binds, { waitSeconds: CALL_WAIT_SECONDS });
  if (!result.ok) return fromFailure(result);
  const proc = toProcResult(result.rows);
  if (!proc.ok) {
    return {
      ok: false,
      error: { code: 'DECLINED', message: proc.message || `${name} declined the request.`, detail: proc },
      fixtures: false,
    };
  }
  return { ok: true, data: proc as T, fixtures: false };
}

/** Combines parallel reads into one result; the first failure wins. */
function combine<A, B, R>(a: DataResult<A>, b: DataResult<B>, join: (a: A, b: B) => R): DataResult<R> {
  if (!a.ok) return a;
  if (!b.ok) return b;
  return { ok: true, data: join(a.data, b.data), fixtures: a.fixtures, fixture_source: a.fixture_source };
}

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

export async function getState(actingAs?: ActingAs): Promise<DataResult<AppState>> {
  const rows = await readRows<AppState>(actingAs, 'SELECT * FROM V_APP_STATE', [], () => fixture(appStateFixture));
  return firstRow(rows, 'V_APP_STATE returned no row.');
}

/** PENDING drafts (red flags first) plus clinician holds, which are never drafts. */
export async function getQueue(actingAs?: ActingAs): Promise<DataResult<QueueBundle>> {
  const who = actingAs ?? (await getActingAs());
  const [items, held] = await Promise.all([
    readRows<QueueItem>(who, 'SELECT * FROM V_QUEUE ORDER BY is_red_flag DESC, priority, action_id', [], () =>
      fixture(queueFixture),
    ),
    readRows<HeldItem>(who, 'SELECT * FROM V_HELD ORDER BY held_until, patient_id', [], () => fixture(heldFixture)),
  ]);
  return combine(items, held, (i, h) => ({ items: i, held: h }));
}

export async function getPatients(actingAs?: ActingAs): Promise<DataResult<PatientListRow[]>> {
  return readRows<PatientListRow>(actingAs, 'SELECT * FROM V_PATIENT_LIST ORDER BY status_rank, patient_id', [], () =>
    fixture(patientListFixture),
  );
}

export async function getPatientDetail(patientId: string, actingAs?: ActingAs): Promise<DataResult<PatientDetail>> {
  const rows = await readRows<PatientDetail>(actingAs, 'SELECT * FROM V_PATIENT_DETAIL WHERE patient_id = ?', [patientId], () => {
    const set = fixture<PatientDetail>(patientDetailFixture);
    return { ...set, rows: set.rows.filter((p) => p.patient_id === patientId) };
  });
  return firstRow(rows, `No patient ${patientId} in the synthetic record.`);
}

export async function getTimeline(patientId: string, actingAs?: ActingAs): Promise<DataResult<TimelineEvent[]>> {
  return readRows<TimelineEvent>(
    actingAs,
    'SELECT * FROM V_TIMELINE WHERE patient_id = ? ORDER BY logged_at DESC',
    [patientId],
    () => {
      const set = fixture<TimelineEvent>(timelineFixture);
      const rows = set.rows
        .filter((e) => e.patient_id === patientId)
        .sort((a, b) => b.logged_at.localeCompare(a.logged_at));
      return { ...set, rows };
    },
  );
}

/** Rules tab: RULES (P0) with edit history, plus Faiz's AI Plan keys and locked terms (read-only). */
export async function getRules(actingAs?: ActingAs): Promise<DataResult<RulesBundle>> {
  const who = actingAs ?? (await getActingAs());
  const [rules, edits, keys, terms] = await Promise.all([
    readRows<RuleRow>(who, 'SELECT * FROM V_RULES ORDER BY condition, priority, rule_id', [], () => fixture(rulesFixture)),
    readRows<RuleEdit>(who, 'SELECT * FROM RULE_EDITS ORDER BY edited_at DESC, edit_id DESC LIMIT 50', [], () =>
      fixture(ruleEditsFixture),
    ),
    readRows<OverrideKey>(who, 'SELECT * FROM OVERRIDE_KEYS ORDER BY setting', [], () => fixture(overrideKeysFixture)),
    readRows<{ term: string }>(who, 'SELECT term FROM SAFETY_LOCKED_TERMS ORDER BY term', [], () =>
      fixture(safetyLockedTermsFixture),
    ),
  ]);
  const first = combine(rules, edits, (r, e) => ({ rules: r, edits: e }));
  const second = combine(keys, terms, (k, t) => ({ override_keys: k, safety_locked_terms: t.map((x) => x.term) }));
  return combine(first, second, (a, b) => ({ ...a, ...b }));
}

/** Recorded answers only (ASK_CACHE); the live agent is a cut stretch goal. */
export async function ask(question: string, actingAs?: ActingAs): Promise<DataResult<AskAnswer>> {
  const rows = await readRows<{ question?: string; answer: unknown }>(
    actingAs,
    'SELECT answer FROM ASK_CACHE WHERE question = ? ORDER BY recorded_at DESC LIMIT 1',
    [question],
    () => {
      const set = fixture<{ question: string; answer: unknown }>(askCacheFixture);
      return { ...set, rows: set.rows.filter((r) => r.question.toLowerCase() === question.toLowerCase()) };
    },
  );
  if (!rows.ok) return rows;
  const answer = rows.data[0]?.answer ?? null;
  return {
    ok: true,
    data: { question, answer, source: 'recorded', message: answer === null ? 'No recorded answer for this question yet.' : null },
    fixtures: rows.fixtures,
    fixture_source: rows.fixture_source,
  };
}

// ---------------------------------------------------------------------------------------------
// Writes (procs). The approver label comes from the server env, never from the request.
// ---------------------------------------------------------------------------------------------

export async function reviewAction(
  actionId: number,
  decision: ReviewDecision,
  note: string | null,
  editedText: string | null,
  actingAs?: ActingAs,
): Promise<DataResult<ReviewResult>> {
  const verb = { APPROVED: 'approved', EDITED: 'edited and approved', REJECTED: 'rejected' }[decision];
  return callProc<ReviewResult>(
    actingAs,
    'TETHER_REVIEW',
    [{ type: 'FIXED', value: actionId }, decision, note, decision === 'EDITED' ? editedText : null, getEnv().approverLabel],
    () => ({
      message: `Fixture mode: draft ${actionId} ${verb}. Nothing was sent or saved.`,
      action_id: actionId,
      status: decision,
    }),
  );
}

export async function logReviewDenied(actionId: number, actingAs?: ActingAs): Promise<DataResult<ProcResult>> {
  return callProc<ProcResult>(actingAs, 'LOG_REVIEW_DENIED', [{ type: 'FIXED', value: actionId }], () => ({
    message: `Fixture mode: the refused review of draft ${actionId} would be logged as REVIEW_DENIED.`,
  }));
}

export async function previewRuleEdit(
  ruleId: string,
  field: RuleField,
  value: number,
  actingAs?: ActingAs,
): Promise<DataResult<RuleEditResult>> {
  return callProc<RuleEditResult>(actingAs, 'PREVIEW_RULE_EDIT', [ruleId, field, { type: 'REAL', value }], () => ({
    message: 'Fixture mode: the preview evaluates V_RULE_FIRINGS only in live mode, so no changes are listed.',
    rule_id: ruleId,
    field,
    new_value: value,
    changed: [],
  }));
}

/** acting_as is passed as a label for the audit row; the gate itself is the role's grants. */
export async function updateRule(
  ruleId: string,
  field: RuleField,
  value: number,
  reason: string,
  actingAs?: ActingAs,
): Promise<DataResult<RuleEditResult>> {
  const { actingAs: who } = await modeFor(actingAs);
  return callProc<RuleEditResult>(who, 'UPDATE_RULE', [ruleId, field, { type: 'REAL', value }, reason, who], () => ({
    message: `Fixture mode: ${ruleId} ${field} would change to ${value}. RULES was not changed.`,
    rule_id: ruleId,
    field,
    new_value: value,
    changed: [],
  }));
}

/** noteId null = the latest note with an AI Plan for every patient (set-based). */
export async function readAiPlan(noteId: string | null, actingAs?: ActingAs): Promise<DataResult<ProcResult>> {
  return callProc<ProcResult>(actingAs, 'READ_AI_PLAN', [noteId], () => ({
    message: `Fixture mode: Claude reads the AI Plan of ${noteId ?? 'every patient'} only in live mode. Nothing changed.`,
  }));
}

/** days 0 = jump to the next ladder event. */
export async function advanceClock(days: number, actingAs?: ActingAs): Promise<DataResult<ClockResult>> {
  const asOf = fixture<AppState>(appStateFixture).rows[0]?.as_of_date;
  return callProc<ClockResult>(actingAs, 'ADVANCE_CLOCK', [{ type: 'FIXED', value: days }], () => ({
    message: `Fixture mode: the simulated clock stays at ${asOf ?? 'its current date'}. No drafts were created.`,
    as_of_date: asOf,
    drafts_created: 0,
  }));
}

export async function simulateCall(
  actionId: number,
  scenario: CallScenario,
  actingAs?: ActingAs,
): Promise<DataResult<CallResult>> {
  return callProc<CallResult>(actingAs, 'SIMULATE_CHECKIN_CALL', [{ type: 'FIXED', value: actionId }, scenario], () => ({
    message: `Fixture mode: the simulated ${scenario} call for draft ${actionId} runs only in live mode. Nothing was logged.`,
  }));
}

export async function demoReset(actingAs?: ActingAs): Promise<DataResult<ProcResult>> {
  return callProc<ProcResult>(actingAs, 'DEMO_RESET', [], () => ({
    message: 'Fixture mode: fixtures never change, so there is nothing to reset.',
  }));
}
