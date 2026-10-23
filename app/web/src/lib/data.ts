import 'server-only';

import { promises as fs } from 'node:fs';
import path from 'node:path';

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

import { effectiveMode, getEnv, type Credentials, type EffectiveMode, type ExportView } from './env';
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
/** Procs that change nothing the screens show, so a call does not clear the read cache. */
const READ_ONLY_PROCS = new Set(['PREVIEW_RULE_EDIT', 'LOG_REVIEW_DENIED']);
/** How long a cached read counts as fresh, per screen. */
const FRESH_MS = { state: 15_000, queue: 10_000, patients: 30_000, patient: 30_000, timeline: 15_000, rules: 60_000 };

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
          code: 'ROLE_REFUSED',
          message: `Fixture mode (simulated): ${getEnv().roleAgent} has no USAGE on ${name}. In live mode the role check refuses this call.`,
          sql_state: null,
        },
        fixtures: true,
      };
    }
    return { ok: true, data: { ...fixtureResult(who), ok: true, fixtures: true } as T, fixtures: true };
  }
  const { statement, binds } = buildCall(name, args);
  if (who === 'agent' && mode.credentials.enforcement === 'app' && CLINICIAN_ONLY.has(name)) {
    return {
      ok: false,
      error: {
        code: 'ROLE_REFUSED',
        message:
          `Refused by the app's role check: Care agent cannot run ${name}. This demo uses one token ` +
          `restricted to ${getEnv().roleClinician}; in Snowflake, ${getEnv().roleAgent} has no USAGE on ${name}.`,
        sql_state: null,
      },
      fixtures: false,
    };
  }
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
  if (!READ_ONLY_PROCS.has(name)) afterWrite(who, mode.credentials);
  return { ok: true, data: proc as T, fixtures: false };
}

// ---------------------------------------------------------------------------------------------
// Read cache. Snowflake compiles the stacked app views on every query (V_PATIENT_DETAIL about 66 s,
// V_PATIENT_LIST about 32 s, against 2-3 s of execution), so live reads are kept per acting role for a
// short time, concurrent requests share one query, and an expired copy is served while a fresh one loads
// in the background. A successful write clears the queue, state, timeline and rules reads at once and
// rebuilds the patient snapshots (sql/65_perf_snapshots.sql) in the background.
// ---------------------------------------------------------------------------------------------

interface CacheEntry {
  loadedAt: number;
  settled?: DataResult<unknown>;
  inflight?: Promise<DataResult<unknown>>;
}

const readCache = new Map<string, CacheEntry>();

function loadInto<T>(key: string, loader: () => Promise<DataResult<T>>): Promise<DataResult<T>> {
  const entry = readCache.get(key) ?? { loadedAt: 0 };
  if (entry.inflight) return entry.inflight as Promise<DataResult<T>>;
  const pending = loader().then(
    (result) => {
      entry.inflight = undefined;
      if (result.ok) {
        entry.settled = result;
        entry.loadedAt = Date.now();
      }
      return result;
    },
    (err: unknown) => {
      entry.inflight = undefined;
      throw err;
    },
  );
  entry.inflight = pending;
  readCache.set(key, entry);
  return pending;
}

/** Fresh copy: served as is. Expired copy: served now, reloaded in the background. No copy: loaded. */
async function cachedRead<T>(key: string, freshMs: number, loader: () => Promise<DataResult<T>>): Promise<DataResult<T>> {
  const entry = readCache.get(key);
  if (entry?.settled) {
    if (Date.now() - entry.loadedAt >= freshMs) void loadInto(key, loader).catch(() => undefined);
    return entry.settled as DataResult<T>;
  }
  return loadInto(key, loader);
}

/** Reads whose stale copy would contradict a write the user just made are dropped; patient reads expire. */
function afterWrite(who: ActingAs, credentials: Parameters<typeof execute>[0]): void {
  for (const [key, entry] of readCache) {
    if (/:(state|queue|timeline|rules)/.test(key)) readCache.delete(key);
    else entry.loadedAt = 0;
  }
  refreshExports(['V_APP_STATE', 'V_TIMELINE'], credentials);
  refreshSnapshots(who, credentials);
}

let snapshotRun: Promise<void> | null = null;
let snapshotAgain = false;

/** One rebuild at a time; a write during a rebuild schedules exactly one more. */
function refreshSnapshots(who: ActingAs, credentials: Parameters<typeof execute>[0]): void {
  if (snapshotRun) {
    snapshotAgain = true;
    return;
  }
  snapshotRun = (async () => {
    do {
      snapshotAgain = false;
      const started = Date.now();
      const results = await Promise.all(
        ['PATIENT_LIST', 'PATIENT_DETAIL'].map((which) => {
          const { statement, binds } = buildCall('REFRESH_SNAPSHOTS', [which]);
          return execute<Row>(credentials, statement, binds, { waitSeconds: CALL_WAIT_SECONDS });
        }),
      );
      const failed = results.find((r) => !r.ok);
      if (failed && !failed.ok) console.error(`[snapshots] refresh failed: ${failed.message}`);
      else {
        console.info(`[snapshots] refreshed for ${who} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
        refreshExports(['V_PATIENT_LIST', 'V_PATIENT_DETAIL'], credentials);
      }
      for (const [key, entry] of readCache) if (/:patient/.test(key)) entry.loadedAt = 0;
    } while (snapshotAgain);
  })()
    .catch((err: unknown) => console.error('[snapshots] refresh failed', err))
    .finally(() => {
      snapshotRun = null;
    });
}

// ---------------------------------------------------------------------------------------------
// Saved exports (EXPORT_VIEWS). In live mode the listed views are read from JSON files in
// app/web/.local/exports/ instead of being queried on every request; the queue, holds, rules and every
// write stay live in Snowflake. A file is saved from Snowflake when it is missing, after every live write
// (state and timeline at once, patient views once their snapshots are rebuilt), in the background once it
// is older than EXPORT_MAX_AGE_MS, and by POST /api/export.
// ---------------------------------------------------------------------------------------------

const EXPORT_DIR = path.join(process.cwd(), '.local', 'exports');
/** An older file is still served at once and re-saved in the background, so changes made outside the app show up. */
const EXPORT_MAX_AGE_MS = 20_000;

/** The live query behind each export; patient views read their snapshot and fall back to the view. */
const EXPORT_QUERIES: Record<ExportView, { snapshot?: string; view: string }> = {
  V_APP_STATE: { view: 'SELECT * FROM V_APP_STATE' },
  V_PATIENT_LIST: {
    snapshot: 'SELECT * FROM PATIENT_LIST_SNAP ORDER BY status_rank, patient_id',
    view: 'SELECT * FROM V_PATIENT_LIST ORDER BY status_rank, patient_id',
  },
  V_PATIENT_DETAIL: {
    snapshot: 'SELECT * FROM PATIENT_DETAIL_SNAP ORDER BY patient_id',
    view: 'SELECT * FROM V_PATIENT_DETAIL ORDER BY patient_id',
  },
  V_TIMELINE: { view: 'SELECT * FROM V_TIMELINE ORDER BY patient_id, logged_at DESC' },
};

function exportFile(view: ExportView): string {
  return path.join(EXPORT_DIR, `${view.toLowerCase()}.json`);
}

/** Credentials when this view is served from its export, else null (fixtures mode, or not listed). */
function exportCredentials(view: ExportView, who: ActingAs): Credentials | null {
  const env = getEnv();
  if (!env.exportViews.includes(view)) return null;
  const mode = effectiveMode(who, env);
  return mode.mode === 'live' ? mode.credentials : null;
}

const exportRuns = new Map<ExportView, Promise<DataResult<number>>>();
/** Saves queued or running per view; an age-based re-save is skipped while one is pending. */
const exportPending = new Map<ExportView, number>();

/** Queries the view and replaces its file (temp file, then rename). Saves of one view run in order. */
function saveExport(view: ExportView, credentials: Credentials): Promise<DataResult<number>> {
  const run = async (): Promise<DataResult<number>> => {
    const { snapshot, view: viewSql } = EXPORT_QUERIES[view];
    let result = snapshot ? await execute<Row>(credentials, snapshot, [], { waitSeconds: READ_WAIT_SECONDS }) : null;
    if (!result || !result.ok) result = await execute<Row>(credentials, viewSql, [], { waitSeconds: READ_WAIT_SECONDS });
    if (!result.ok) {
      console.error(`[exports] ${view} not saved: ${result.message}`);
      return fromFailure(result);
    }
    const rows = result.rows.map((r) => normalizeRow<Row>(r));
    const savedAt = new Date().toLocaleString('sv-SE');
    await fs.mkdir(EXPORT_DIR, { recursive: true });
    const tmp = `${exportFile(view)}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ _source: `live export @ ${savedAt}`, rows }), 'utf8');
    await fs.rename(tmp, exportFile(view));
    return { ok: true, data: rows.length, fixtures: false };
  };
  exportPending.set(view, (exportPending.get(view) ?? 0) + 1);
  const next = (exportRuns.get(view) ?? Promise.resolve(null))
    .catch(() => null)
    .then(run)
    .finally(() => exportPending.set(view, (exportPending.get(view) ?? 1) - 1));
  exportRuns.set(view, next);
  return next;
}

/** Background re-save after a write; a failed save keeps the previous file. */
function refreshExports(views: ExportView[], credentials: Credentials): void {
  for (const view of views) {
    if (!getEnv().exportViews.includes(view)) continue;
    void saveExport(view, credentials).catch((err: unknown) => console.error(`[exports] ${view} not saved`, err));
  }
}

let staleCheckAt = 0;
const PATIENT_EXPORTS: ExportView[] = ['V_PATIENT_LIST', 'V_PATIENT_DETAIL'];

/**
 * Patient exports are saved from the snapshots. When an aged file is read: rebuild the snapshots if
 * AUDIT_LOG (every write) is newer than the last rebuild, else re-save the exports if a rebuild made
 * outside the app (scripts/run_sql.sh) is newer than the files.
 */
function checkPatientExports(who: ActingAs, credentials: Credentials): void {
  if (snapshotRun || Date.now() - staleCheckAt < EXPORT_MAX_AGE_MS) return;
  staleCheckAt = Date.now();
  void (async () => {
    const check = await execute<Row>(
      credentials,
      'SELECT DATE_PART(epoch_millisecond, MAX(refreshed_at)) AS snap_ms, ' +
        '(SELECT MAX(logged_at) FROM AUDIT_LOG) > MAX(refreshed_at)::TIMESTAMP_NTZ AS stale ' +
        'FROM SNAPSHOT_LOG WHERE ok',
      [],
      { waitSeconds: READ_WAIT_SECONDS },
    );
    const row = check.ok ? normalizeRow<{ stale?: unknown; snap_ms?: unknown }>(check.rows[0] ?? {}) : null;
    if (!row || row.stale !== false) {
      refreshSnapshots(who, credentials);
      return;
    }
    const mtimes = await Promise.all(
      PATIENT_EXPORTS.map((view) => fs.stat(exportFile(view)).then((s) => s.mtimeMs, () => 0)),
    );
    if (Number(row.snap_ms) > Math.min(...mtimes)) refreshExports(PATIENT_EXPORTS, credentials);
  })().catch((err: unknown) => console.error('[exports] staleness check failed', err));
}

/** Rows of a saved export, saved first when the file is missing (first start, or after a reset). */
async function readExport<T>(view: ExportView, who: ActingAs, credentials: Credentials): Promise<DataResult<T[]>> {
  const file = exportFile(view);
  const stat = await fs.stat(file).catch(() => null);
  if (!stat) {
    const saved = await saveExport(view, credentials);
    if (!saved.ok) return saved;
  } else if (Date.now() - stat.mtimeMs > EXPORT_MAX_AGE_MS && !exportPending.get(view)) {
    if (PATIENT_EXPORTS.includes(view)) checkPatientExports(who, credentials);
    else refreshExports([view], credentials);
  }
  const set = fixture<T>(JSON.parse(await fs.readFile(file, 'utf8')) as unknown);
  return { ok: true, data: set.rows, fixtures: true, fixture_source: set.source };
}

/** Re-saves every exported view from Snowflake now, optionally rebuilding the patient snapshots first. */
export async function saveExportsNow(
  rebuildSnapshots: boolean,
  actingAs?: ActingAs,
): Promise<DataResult<{ saved: Partial<Record<ExportView, number>> }>> {
  const { mode } = await modeFor(actingAs);
  if (mode.mode !== 'live') {
    return { ok: false, error: { code: 'BAD_REQUEST', message: 'Exports are saved from live Snowflake; the app is not live.' }, fixtures: true };
  }
  if (rebuildSnapshots) {
    const { statement, binds } = buildCall('REFRESH_SNAPSHOTS', ['ALL']);
    const rebuilt = await execute<Row>(mode.credentials, statement, binds, { waitSeconds: CALL_WAIT_SECONDS });
    if (!rebuilt.ok) return fromFailure(rebuilt);
  }
  const views = getEnv().exportViews;
  const results = await Promise.all(views.map((view) => saveExport(view, mode.credentials)));
  const saved: Partial<Record<ExportView, number>> = {};
  for (const [i, result] of results.entries()) {
    if (!result.ok) return { ok: false, error: result.error, fixtures: false };
    saved[views[i]] = result.data;
  }
  return { ok: true, data: { saved }, fixtures: false };
}

/** Snapshot first; the view if the snapshot is missing (not created yet, or this role lacks the grant). */
async function readSnapshotOrView<T>(
  who: ActingAs,
  snapshotSql: string,
  viewSql: string,
  binds: Bind[],
  fromFixture: () => FixtureSet<T>,
): Promise<DataResult<T[]>> {
  const snap = await readRows<T>(who, snapshotSql, binds, fromFixture);
  if (snap.ok) return snap;
  return readRows<T>(who, viewSql, binds, fromFixture);
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
  const who = actingAs ?? (await getActingAs());
  const exported = exportCredentials('V_APP_STATE', who);
  if (exported) {
    // Writes stay live, so this is not fixture mode: the banner stays off; fixture_source names the file.
    const row = firstRow(await readExport<AppState>('V_APP_STATE', who, exported), 'The V_APP_STATE export has no row.');
    return { ...row, fixtures: false };
  }
  return cachedRead(`${who}:state`, FRESH_MS.state, async () => {
    const rows = await readRows<AppState>(who, 'SELECT * FROM V_APP_STATE', [], () => fixture(appStateFixture));
    return firstRow(rows, 'V_APP_STATE returned no row.');
  });
}

/** PENDING drafts (red flags first) plus clinician holds, which are never drafts. */
export async function getQueue(actingAs?: ActingAs): Promise<DataResult<QueueBundle>> {
  const who = actingAs ?? (await getActingAs());
  return cachedRead(`${who}:queue`, FRESH_MS.queue, async () => {
    const [items, held] = await Promise.all([
      readRows<QueueItem>(who, 'SELECT * FROM V_QUEUE ORDER BY is_red_flag DESC, priority, action_id', [], () =>
        fixture(queueFixture),
      ),
      readRows<HeldItem>(who, 'SELECT * FROM V_HELD ORDER BY held_until, patient_id', [], () => fixture(heldFixture)),
    ]);
    return combine(items, held, (i, h) => ({ items: i, held: h }));
  });
}

export async function getPatients(actingAs?: ActingAs): Promise<DataResult<PatientListRow[]>> {
  const who = actingAs ?? (await getActingAs());
  const exported = exportCredentials('V_PATIENT_LIST', who);
  if (exported) return readExport<PatientListRow>('V_PATIENT_LIST', who, exported);
  return cachedRead(`${who}:patients`, FRESH_MS.patients, () =>
    readSnapshotOrView<PatientListRow>(
      who,
      'SELECT * FROM PATIENT_LIST_SNAP ORDER BY status_rank, patient_id',
      'SELECT * FROM V_PATIENT_LIST ORDER BY status_rank, patient_id',
      [],
      () => fixture(patientListFixture),
    ),
  );
}

export async function getPatientDetail(patientId: string, actingAs?: ActingAs): Promise<DataResult<PatientDetail>> {
  const who = actingAs ?? (await getActingAs());
  const exported = exportCredentials('V_PATIENT_DETAIL', who);
  if (exported) {
    const rows = await readExport<PatientDetail>('V_PATIENT_DETAIL', who, exported);
    const one = rows.ok ? { ...rows, data: rows.data.filter((p) => p.patient_id === patientId) } : rows;
    return firstRow(one, `No patient ${patientId} in the synthetic record.`);
  }
  return cachedRead(`${who}:patient:${patientId}`, FRESH_MS.patient, async () => {
    const rows = await readSnapshotOrView<PatientDetail>(
      who,
      'SELECT * FROM PATIENT_DETAIL_SNAP WHERE patient_id = ?',
      'SELECT * FROM V_PATIENT_DETAIL WHERE patient_id = ?',
      [patientId],
      () => {
        const set = fixture<PatientDetail>(patientDetailFixture);
        return { ...set, rows: set.rows.filter((p) => p.patient_id === patientId) };
      },
    );
    return firstRow(rows, `No patient ${patientId} in the synthetic record.`);
  });
}

export async function getTimeline(patientId: string, actingAs?: ActingAs): Promise<DataResult<TimelineEvent[]>> {
  const who = actingAs ?? (await getActingAs());
  const exported = exportCredentials('V_TIMELINE', who);
  if (exported) {
    const rows = await readExport<TimelineEvent>('V_TIMELINE', who, exported);
    if (!rows.ok) return rows;
    const events = rows.data
      .filter((e) => e.patient_id === patientId)
      .sort((a, b) => String(b.logged_at).localeCompare(String(a.logged_at)));
    return { ...rows, data: events };
  }
  return cachedRead(`${who}:timeline:${patientId}`, FRESH_MS.timeline, () =>
    readRows<TimelineEvent>(
      who,
      'SELECT * FROM V_TIMELINE WHERE patient_id = ? ORDER BY logged_at DESC',
      [patientId],
      () => {
        const set = fixture<TimelineEvent>(timelineFixture);
        const rows = set.rows
          .filter((e) => e.patient_id === patientId)
          .sort((a, b) => b.logged_at.localeCompare(a.logged_at));
        return { ...set, rows };
      },
    ),
  );
}

/** Rules tab: RULES (P0) with edit history, plus Faiz's AI Plan keys and locked terms (read-only). */
export async function getRules(actingAs?: ActingAs): Promise<DataResult<RulesBundle>> {
  const who = actingAs ?? (await getActingAs());
  return cachedRead(`${who}:rules`, FRESH_MS.rules, () => loadRules(who));
}

async function loadRules(who: ActingAs): Promise<DataResult<RulesBundle>> {
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
