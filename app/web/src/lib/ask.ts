import 'server-only';

import type { AskAgentAnswer, AskCheck } from '@/components/ask/questions';
import askFixture from '@/fixtures/ask.json';
import askCacheFixture from '@/fixtures/ask_cache.json';

import { effectiveMode, getEnv, type Credentials } from './env';
import { getActingAs } from './session';
import { execute, type Row, type SnowflakeFailure } from './snowflake';
import type { ActingAs, DataResult } from './types';

// Ask drawer backend. Live mode runs the Cortex Agent (TETHER_ASK) through DATA_AGENT_RUN with the
// question as a bind value, checks the answer text against SAFETY_TERMS, and falls back to the
// latest ASK_CACHE answer when the agent does not answer. Fixtures mode serves src/fixtures/ask.json,
// then src/fixtures/ask_cache.json.

const AGENT_WAIT_SECONDS = 120;
const READ_WAIT_SECONDS = 60;

const MODEL_STATEMENT = "SELECT value FROM TETHER_SETTINGS WHERE key = 'MODEL_AGENT'";
const TERMS_STATEMENT = 'SELECT LOWER(term) AS term, kind FROM SAFETY_TERMS';
const CACHE_STATEMENT =
  "SELECT answer, TO_VARCHAR(recorded_at, 'YYYY-MM-DD HH24:MI') AS recorded_at FROM ASK_CACHE " +
  'WHERE LOWER(TRIM(question)) = LOWER(TRIM(?)) ORDER BY recorded_at DESC LIMIT 1';

const IDENTIFIER = /^[A-Z][A-Z0-9_]*$/i;
const CHECKED_KINDS = new Set(['DRUG_NAME', 'DOSE_UNIT', 'DRUG_CLASS']);
/** Glucose readings are written in mg/dL; that unit is a reading, not a dose. */
const READING_UNIT = /mg\s*\/\s*dl/gi;

const NO_RECORDED_ANSWER = 'No recorded answer for this question yet. Try one of the suggested questions.';
const CHECK_NOT_RUN = 'Medication word check did not run.';

export interface AgentReply {
  text: string | null;
  sql: string | null;
  model: string | null;
}

interface RecordedAnswer extends AgentReply {
  recordedAt: string | null;
}

interface SafetyTerm {
  term: string;
  pattern: RegExp;
}

// Per-process caches, filled on the first successful read.
let termsCache: SafetyTerm[] | null = null;
let modelCache: { value: string | null } | null = null;

// ---------------------------------------------------------------------------------------------
// Agent response parsing
// ---------------------------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** First non-empty string under any of the keys, depth first. JSON text that mentions a key is parsed and walked too. */
function findString(node: unknown, keys: Set<string>, depth = 0): string | null {
  if (depth > 40) return null;
  if (typeof node === 'string') {
    const trimmed = node.trim();
    if (trimmed.startsWith('{') && [...keys].some((k) => trimmed.includes(`"${k}"`))) {
      return findString(parseJson(trimmed), keys, depth + 1);
    }
    return null;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findString(item, keys, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (!isRecord(node)) return null;
  for (const [key, value] of Object.entries(node)) {
    if (keys.has(key.toLowerCase()) && nonEmpty(value)) return nonEmpty(value);
  }
  for (const value of Object.values(node)) {
    const found = findString(value, keys, depth + 1);
    if (found) return found;
  }
  return null;
}

/** The answer content array: top-level content, message.content, or the last message's content. */
function contentItems(root: Record<string, unknown>): unknown[] {
  if (Array.isArray(root.content)) return root.content;
  if (isRecord(root.message) && Array.isArray(root.message.content)) return root.message.content;
  if (Array.isArray(root.messages)) {
    const last: unknown = root.messages[root.messages.length - 1];
    if (isRecord(last) && Array.isArray(last.content)) return last.content;
  }
  return [];
}

function textOf(item: unknown): string | null {
  return isRecord(item) && item.type === 'text' ? nonEmpty(item.text) : null;
}

/** First content[].json.sql of a tool_result item. */
function toolResultSql(item: unknown): string | null {
  if (!isRecord(item) || !isRecord(item.tool_result) || !Array.isArray(item.tool_result.content)) return null;
  for (const part of item.tool_result.content) {
    const sql = isRecord(part) && isRecord(part.json) ? nonEmpty(part.json.sql) : null;
    if (sql) return sql;
  }
  return null;
}

/**
 * Reads the DATA_AGENT_RUN response (JSON text or an object), shaped
 * {content: [{type: 'text', text} | {type: 'tool_result', tool_result: {name, content: [{json: {sql}}]}}], metadata: {orchestration_model}}.
 * Answer: the 'text' items after the last tool result (planning text before a tool call is left
 * out), or every 'text' item when none follow it. SQL: the last system_execute_sql result, else the
 * last tool result with SQL (CareAnalyst), else the first 'sql' string anywhere. Model:
 * metadata.orchestration_model, else the first 'model' / 'model_name' string. Missing parts are null.
 */
export function parseAgentResponse(raw: unknown): AgentReply {
  const root = typeof raw === 'string' ? parseJson(raw) : raw;
  if (!isRecord(root)) return { text: null, sql: null, model: null };
  const items = contentItems(root);

  let lastTool = -1;
  let executedSql: string | null = null;
  let toolSql: string | null = null;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!isRecord(item) || !isRecord(item.tool_result)) continue;
    lastTool = index;
    const sql = toolResultSql(item);
    if (!sql) continue;
    if (item.tool_result.name === 'system_execute_sql') executedSql = sql;
    else toolSql = sql;
  }
  const allTexts = items.map(textOf).filter((t): t is string => t !== null);
  const finalTexts = items.slice(lastTool + 1).map(textOf).filter((t): t is string => t !== null);
  const texts = finalTexts.length > 0 ? finalTexts : allTexts;

  const metadata = isRecord(root.metadata) ? root.metadata : {};
  return {
    text: texts.length > 0 ? texts.join('\n\n') : null,
    sql: executedSql ?? toolSql ?? findString(root, new Set(['sql'])),
    model: nonEmpty(metadata.orchestration_model) ?? findString(root, new Set(['orchestration_model', 'model', 'model_name'])),
  };
}

/** ASK_CACHE.answer and fixture answers are {"text", "sql", "model"}; plain text is accepted too. */
function readRecordedAnswer(value: unknown): AgentReply {
  const parsed = typeof value === 'string' ? (parseJson(value) ?? value) : value;
  if (typeof parsed === 'string') return { text: nonEmpty(parsed), sql: null, model: null };
  if (!isRecord(parsed)) return { text: null, sql: null, model: null };
  return { text: nonEmpty(parsed.text), sql: nonEmpty(parsed.sql), model: nonEmpty(parsed.model) };
}

// ---------------------------------------------------------------------------------------------
// Recorded-at formatting
// ---------------------------------------------------------------------------------------------

const STAMP = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/;

/** 'YYYY-MM-DD HH:MI' for the label; other text is shown as is. */
function labelTime(recordedAt: string): string {
  const match = STAMP.exec(recordedAt);
  return match ? `${match[1]} ${match[2]}` : recordedAt;
}

/** ISO form of a recorded-at value (wall-clock time, no zone, like TIMESTAMP_NTZ). */
function toIso(recordedAt: string | null): string | null {
  if (!recordedAt) return null;
  const match = STAMP.exec(recordedAt);
  if (!match) return recordedAt;
  return recordedAt.includes('T') ? recordedAt : `${match[1]}T${match[2]}:00`;
}

function recordedLabel(recordedAt: string | null): string {
  return recordedAt ? `Recorded answer (${labelTime(recordedAt)})` : 'Recorded answer';
}

// ---------------------------------------------------------------------------------------------
// Check step
// ---------------------------------------------------------------------------------------------

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-word, case-insensitive; a space in a term matches any run of whitespace. */
function termPattern(term: string): RegExp {
  const body = escapeRegExp(term).replace(/\s+/g, '\\s+');
  return new RegExp(`(^|[^a-z0-9])${body}(?=$|[^a-z0-9])`, 'i');
}

async function loadTerms(credentials: Credentials): Promise<SafetyTerm[] | null> {
  if (termsCache) return termsCache;
  const result = await execute<Row>(credentials, TERMS_STATEMENT, [], { waitSeconds: READ_WAIT_SECONDS });
  if (!result.ok) return null;
  termsCache = result.rows
    .filter((r) => typeof r.term === 'string' && r.term.trim() && CHECKED_KINDS.has(String(r.kind).toUpperCase()))
    .map((r) => {
      const term = String(r.term).trim();
      return { term, pattern: termPattern(term) };
    });
  return termsCache;
}

async function checkAnswer(credentials: Credentials, text: string, sql: string | null): Promise<AskCheck> {
  const sqlPresent = sql !== null;
  const terms = await loadTerms(credentials);
  if (!terms) return { sql_present: sqlPresent, safety_terms_ok: null, notes: CHECK_NOT_RUN };
  const plain = text.replace(READING_UNIT, ' ');
  const hit = terms.find((t) => t.pattern.test(plain));
  if (hit) {
    return {
      sql_present: sqlPresent,
      safety_terms_ok: false,
      notes: `This answer mentions a medication term (${hit.term}). Review it before use.`,
    };
  }
  return { sql_present: sqlPresent, safety_terms_ok: true, notes: null };
}

// ---------------------------------------------------------------------------------------------
// Snowflake reads
// ---------------------------------------------------------------------------------------------

/** MODEL_AGENT from TETHER_SETTINGS when the agent response names no model. */
async function agentModel(credentials: Credentials): Promise<string | null> {
  if (modelCache) return modelCache.value;
  const result = await execute<Row>(credentials, MODEL_STATEMENT, [], { waitSeconds: READ_WAIT_SECONDS });
  if (!result.ok) return null;
  modelCache = { value: nonEmpty(result.rows[0]?.value) };
  return modelCache.value;
}

function agentFailure(message: string): SnowflakeFailure {
  return { ok: false, code: 'SNOWFLAKE_ERROR', message, sqlState: null };
}

async function runAgent(
  credentials: Credentials,
  question: string,
): Promise<{ ok: true; reply: AgentReply & { text: string } } | SnowflakeFailure> {
  const env = getEnv();
  const parts = [env.database, env.schema, env.agentName];
  if (!parts.every((p) => IDENTIFIER.test(p))) return agentFailure('The agent name in the server settings is not valid.');
  // The agent name is a constant literal built only from IDENTIFIER-checked parts; the request
  // JSON that carries the question is a bind value.
  const statement = `SELECT SNOWFLAKE.CORTEX.DATA_AGENT_RUN('${parts.join('.')}', ?) AS RESPONSE`;
  const requestJson = JSON.stringify({ messages: [{ role: 'user', content: [{ type: 'text', text: question }] }] });
  const result = await execute<Row>(credentials, statement, [requestJson], { waitSeconds: AGENT_WAIT_SECONDS });
  if (!result.ok) return result;
  const reply = parseAgentResponse(result.rows[0]?.response);
  if (reply.text === null) return agentFailure('The agent returned no answer text.');
  return { ok: true, reply: { ...reply, text: reply.text } };
}

async function readCache(credentials: Credentials, question: string): Promise<RecordedAnswer | null> {
  const result = await execute<Row>(credentials, CACHE_STATEMENT, [question], { waitSeconds: READ_WAIT_SECONDS });
  if (!result.ok || !result.rows[0]) return null;
  const answer = readRecordedAnswer(result.rows[0].answer);
  if (answer.text === null) return null;
  return { ...answer, recordedAt: nonEmpty(result.rows[0].recorded_at) };
}

function fallbackMessage(failure: SnowflakeFailure): string {
  if (failure.code === 'SNOWFLAKE_REFUSED') return 'Ask is not available for this role, so this is the recorded answer.';
  if (failure.code === 'TIMEOUT') return 'The live agent took too long to answer, so this is the recorded answer.';
  return 'The live agent did not answer, so this is the recorded answer.';
}

function failureMessage(failure: SnowflakeFailure): string {
  if (failure.code === 'SNOWFLAKE_REFUSED') return 'Ask is not available for this role, and no answer is recorded for this question.';
  if (failure.code === 'TIMEOUT') return 'The agent took too long to answer, and no answer is recorded for this question.';
  return 'The agent did not answer, and no answer is recorded for this question.';
}

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

interface FixtureAnswer extends RecordedAnswer {
  question: string;
}

function lowerKeys(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toLowerCase(), value]));
}

/** Reads {"_source", "rows": [{question, answer: {text, sql, model}, recorded_at}]}; keys in any case. */
function readFixture(file: unknown): { rows: FixtureAnswer[]; source: string } {
  const wrapped = isRecord(file);
  const rows = wrapped ? file.rows : file;
  const list = Array.isArray(rows) ? rows : [];
  return {
    source: wrapped && typeof file._source === 'string' ? file._source : 'unknown',
    rows: list
      .filter(isRecord)
      .map(lowerKeys)
      .map((r) => ({
        question: typeof r.question === 'string' ? r.question : '',
        recordedAt: nonEmpty(r.recorded_at),
        ...readRecordedAnswer(r.answer),
      })),
  };
}

/** Latest fixture answer for the question: ask.json first, then the ASK_CACHE fixture. */
function fromFixture(question: string): DataResult<AskAgentAnswer> {
  const wanted = question.trim().toLowerCase();
  const sets = [readFixture(askFixture), readFixture(askCacheFixture)];
  const matches = sets.map((s) =>
    s.rows
      .filter((r) => r.question.trim().toLowerCase() === wanted && r.text !== null)
      .sort((a, b) => (b.recordedAt ?? '').localeCompare(a.recordedAt ?? ''))[0],
  );
  const hit = matches.findIndex((r) => r !== undefined);
  const set = sets[hit === -1 ? 0 : hit];
  const row = hit === -1 ? undefined : matches[hit];
  const data: AskAgentAnswer = {
    question,
    answer: row?.text ?? null,
    sql: row?.sql ?? null,
    source: 'recorded',
    model: row?.model ?? null,
    recorded_at: toIso(row?.recordedAt ?? null),
    label: recordedLabel(row?.recordedAt ?? null),
    message: row?.text ? null : NO_RECORDED_ANSWER,
    check: {
      sql_present: (row?.sql ?? null) !== null,
      safety_terms_ok: null,
      notes: row?.text ? CHECK_NOT_RUN : null,
    },
  };
  return { ok: true, data, fixtures: true, fixture_source: set.source };
}

// ---------------------------------------------------------------------------------------------
// Ask
// ---------------------------------------------------------------------------------------------

export async function askAgent(question: string, actingAs?: ActingAs): Promise<DataResult<AskAgentAnswer>> {
  const who = actingAs ?? (await getActingAs());
  const mode = effectiveMode(who);
  if (mode.mode === 'fixtures') return fromFixture(question);
  const { credentials } = mode;

  const live = await runAgent(credentials, question);
  if (live.ok) {
    const [check, model] = await Promise.all([
      checkAnswer(credentials, live.reply.text, live.reply.sql),
      live.reply.model ? Promise.resolve(live.reply.model) : agentModel(credentials),
    ]);
    return {
      ok: true,
      data: {
        question,
        answer: live.reply.text,
        sql: live.reply.sql,
        source: 'live',
        model,
        recorded_at: null,
        label: 'Live answer',
        message: null,
        check,
      },
      fixtures: false,
    };
  }

  console.error(`ask_agent_failed code=${live.code}`);
  const recorded = await readCache(credentials, question);
  if (!recorded || recorded.text === null) {
    return { ok: false, error: { code: live.code, message: failureMessage(live), sql_state: live.sqlState }, fixtures: false };
  }
  const [check, model] = await Promise.all([
    checkAnswer(credentials, recorded.text, recorded.sql),
    recorded.model ? Promise.resolve(recorded.model) : agentModel(credentials),
  ]);
  return {
    ok: true,
    data: {
      question,
      answer: recorded.text,
      sql: recorded.sql,
      source: 'recorded',
      model,
      recorded_at: toIso(recorded.recordedAt),
      label: recordedLabel(recorded.recordedAt),
      message: fallbackMessage(live),
      check,
    },
    fixtures: false,
  };
}
