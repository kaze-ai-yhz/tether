import 'server-only';

import { randomUUID } from 'node:crypto';

import { getEnv, type Credentials } from './env';

// Snowflake SQL API v2 client (POST /api/v2/statements). One statement per request, values only
// through bindings: user input is never interpolated into SQL text. The PAT goes only into the
// Authorization header and is never logged or returned.

/** Non-null bind values. A NULL argument is written as the literal NULL by the caller (see call()). */
export type BindValue = string | number | boolean;
export type BindType = 'TEXT' | 'FIXED' | 'REAL' | 'BOOLEAN';
export type Bind = BindValue | { type: BindType; value: BindValue };

export type SnowflakeErrorCode = 'SNOWFLAKE_REFUSED' | 'SNOWFLAKE_ERROR' | 'TIMEOUT';

export interface SnowflakeFailure {
  ok: false;
  code: SnowflakeErrorCode;
  message: string;
  sqlState: string | null;
}

export type Row = Record<string, unknown>;
export type SnowflakeResult<T = Row> = { ok: true; rows: T[] } | SnowflakeFailure;

export interface ExecuteOptions {
  /** How long the app waits for the result, polling every second (default 150 s). */
  waitSeconds?: number;
}

interface ColumnType {
  name: string;
  type: string;
  scale?: number | null;
}

interface ApiBody {
  code?: string;
  message?: string;
  sqlState?: string;
  statementHandle?: string;
  resultSetMetaData?: { rowType?: ColumnType[]; partitionInfo?: unknown[] };
  data?: (string | null)[][];
}

const POLL_INTERVAL_MS = 1000;
const DEFAULT_WAIT_SECONDS = 150;
/** Snowflake-side cap. Longer than the app's wait so a slow model call can still finish. */
const STATEMENT_TIMEOUT_SECONDS = 300;
const HTTP_TIMEOUT_MS = 60_000;

// Privilege refusals. Snowflake reports a procedure the role cannot use as unknown (002141),
// and a missing or hidden object as "does not exist or not authorized" (002003).
const REFUSAL_CODES = new Set(['003001', '002003', '002141']);
const REFUSAL_TEXT = [
  /insufficient privileges/i,
  /does not exist or not authorized/i,
  /not authorized/i,
  /unknown user-defined function/i,
  /unknown function/i,
];

export function classifyError(code: string | undefined, sqlState: string | undefined, message: string): SnowflakeErrorCode {
  if (sqlState === '42501' || (code && REFUSAL_CODES.has(code)) || REFUSAL_TEXT.some((p) => p.test(message))) {
    return 'SNOWFLAKE_REFUSED';
  }
  // 000630 / 57014: statement reached its statement or warehouse timeout and was cancelled.
  if (code === '000630' || sqlState === '57014') return 'TIMEOUT';
  return 'SNOWFLAKE_ERROR';
}

function failure(code: SnowflakeErrorCode, message: string, sqlState: string | null = null): SnowflakeFailure {
  return { ok: false, code, message, sqlState };
}

function toBinding(bind: Bind): { type: BindType; value: string } {
  if (typeof bind === 'object') return { type: bind.type, value: String(bind.value) };
  if (typeof bind === 'boolean') return { type: 'BOOLEAN', value: bind ? 'true' : 'false' };
  if (typeof bind === 'number') {
    if (!Number.isFinite(bind)) throw new Error('Bind values must be finite numbers');
    return { type: Number.isInteger(bind) ? 'FIXED' : 'REAL', value: String(bind) };
  }
  return { type: 'TEXT', value: bind };
}

function isoFromEpochDays(days: number): string {
  return new Date(days * 86_400_000).toISOString().slice(0, 10);
}

function isoFromEpochSeconds(raw: string, keepZone: boolean): string | null {
  const seconds = Number(raw.split(' ')[0]);
  if (!Number.isFinite(seconds)) return null;
  const iso = new Date(Math.round(seconds * 1000)).toISOString();
  return keepZone ? iso : iso.slice(0, -1); // TIMESTAMP_NTZ is wall-clock time: drop the Z
}

/** SQL API values are strings (or null); convert by column type. */
function convert(value: string | null, column: ColumnType): unknown {
  if (value === null) return null;
  switch (column.type.toLowerCase()) {
    case 'fixed':
    case 'real':
    case 'float':
    case 'double':
    case 'decfloat':
    case 'number': {
      const n = Number(value);
      return Number.isNaN(n) ? value : n;
    }
    case 'boolean':
      return value === 'true' || value === '1';
    case 'variant':
    case 'object':
    case 'array':
    case 'map':
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    case 'date':
      return /^-?\d+$/.test(value) ? isoFromEpochDays(Number(value)) : value;
    case 'timestamp_ntz':
      return isoFromEpochSeconds(value, false) ?? value;
    case 'timestamp_ltz':
    case 'timestamp_tz':
      return isoFromEpochSeconds(value, true) ?? value;
    default:
      return value;
  }
}

function mapRows<T>(columns: ColumnType[], data: (string | null)[][]): T[] {
  const keys = columns.map((c) => c.name.toLowerCase());
  return data.map((cells) => {
    const row: Row = {};
    columns.forEach((column, i) => {
      row[keys[i]] = convert(cells[i] ?? null, column);
    });
    return row as T;
  });
}

async function parseBody(res: Response): Promise<ApiBody> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as ApiBody;
  } catch {
    return { message: text.slice(0, 300) };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stillRunning(): SnowflakeFailure {
  return failure(
    'TIMEOUT',
    'Snowflake is still working on this. Refresh in a minute to see the result.',
  );
}

/**
 * Runs one statement as the given role. Handles 202 polling, extra result partitions and
 * error mapping. Never throws for Snowflake or network failures.
 */
export async function execute<T = Row>(
  credentials: Credentials,
  statement: string,
  binds: Bind[] = [],
  options: ExecuteOptions = {},
): Promise<SnowflakeResult<T>> {
  const env = getEnv();
  const base = `https://${credentials.host}/api/v2/statements`;
  const deadline = Date.now() + (options.waitSeconds ?? DEFAULT_WAIT_SECONDS) * 1000;
  const headers = {
    Authorization: `Bearer ${credentials.token}`,
    'X-Snowflake-Authorization-Token-Type': 'PROGRAMMATIC_ACCESS_TOKEN',
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': 'tether-app/0.1',
  };

  let bindings: Record<string, { type: BindType; value: string }> | undefined;
  try {
    bindings = binds.length ? Object.fromEntries(binds.map((b, i) => [String(i + 1), toBinding(b)])) : undefined;
  } catch (err) {
    return failure('SNOWFLAKE_ERROR', err instanceof Error ? err.message : 'Invalid bind value');
  }
  const body = JSON.stringify({
    statement,
    timeout: STATEMENT_TIMEOUT_SECONDS,
    database: env.database,
    schema: env.schema,
    warehouse: env.warehouse,
    role: credentials.role,
    bindings,
  });

  const send = async (url: string, init: RequestInit): Promise<Response | SnowflakeFailure> => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return stillRunning();
    try {
      return await fetch(url, {
        ...init,
        headers,
        cache: 'no-store',
        signal: AbortSignal.timeout(Math.min(remaining, HTTP_TIMEOUT_MS)),
      });
    } catch (err) {
      if (Date.now() >= deadline) return stillRunning();
      const reason = err instanceof Error && err.name === 'TimeoutError' ? 'timed out' : 'failed';
      return failure('SNOWFLAKE_ERROR', `The request to Snowflake ${reason}. Check the network and try again.`);
    }
  };

  const requestId = randomUUID();
  let submitted = await send(`${base}?requestId=${requestId}`, { method: 'POST', body });

  // 429 on submit: the request was not accepted. Resubmit with the same requestId and retry=true
  // so Snowflake never runs the statement twice.
  while (submitted instanceof Response && submitted.status === 429) {
    await submitted.body?.cancel();
    await sleep(POLL_INTERVAL_MS);
    submitted = await send(`${base}?requestId=${requestId}&retry=true`, { method: 'POST', body });
  }
  if (!(submitted instanceof Response)) return submitted;
  let res: Response = submitted;

  let payload = await parseBody(res);

  // 202 = still running: poll the statement handle every second until done or out of time.
  while (res.status === 202 || (res.status === 429 && payload.statementHandle)) {
    const handle = payload.statementHandle;
    if (!handle) return failure('SNOWFLAKE_ERROR', 'Snowflake did not return a statement handle.');
    await sleep(POLL_INTERVAL_MS);
    const next = await send(`${base}/${encodeURIComponent(handle)}`, { method: 'GET' });
    if (!(next instanceof Response)) return next;
    res = next;
    const polled = await parseBody(res);
    payload = { ...polled, statementHandle: polled.statementHandle ?? handle };
  }

  if (res.status !== 200) return errorFor(res.status, payload, credentials.role, statement);

  const columns = payload.resultSetMetaData?.rowType ?? [];
  const data = [...(payload.data ?? [])];
  const partitions = payload.resultSetMetaData?.partitionInfo?.length ?? 1;
  const handle = payload.statementHandle;
  for (let p = 1; p < partitions && handle; p += 1) {
    const part = await send(`${base}/${encodeURIComponent(handle)}?partition=${p}`, { method: 'GET' });
    if (!(part instanceof Response)) return part;
    const partBody = await parseBody(part);
    if (part.status !== 200) return errorFor(part.status, partBody, credentials.role, statement);
    data.push(...(partBody.data ?? []));
  }

  return { ok: true, rows: mapRows<T>(columns, data) };
}

function errorFor(status: number, payload: ApiBody, role: string, statement: string): SnowflakeFailure {
  const message = payload.message?.trim() || `Snowflake returned HTTP ${status}.`;
  let result: SnowflakeFailure;
  if (status === 408) {
    result = failure('TIMEOUT', 'Snowflake stopped the statement because it ran too long.', payload.sqlState ?? null);
  } else if (status === 401) {
    result = failure(
      'SNOWFLAKE_ERROR',
      `Snowflake did not accept the access token for ${role}. Mint a new token or check its role restriction.`,
      payload.sqlState ?? null,
    );
  } else if (status === 422) {
    result = failure(classifyError(payload.code, payload.sqlState, message), message, payload.sqlState ?? null);
  } else {
    result = failure('SNOWFLAKE_ERROR', message, payload.sqlState ?? null);
  }
  // Statement text holds only constants and ? placeholders; bind values and tokens are not logged.
  console.error(`[snowflake] ${result.code} http=${status} code=${payload.code ?? '-'} sqlState=${payload.sqlState ?? '-'} role=${role} statement="${statement.slice(0, 80)}": ${message}`);
  return result;
}

const PROC_NAME = /^[A-Z][A-Z0-9_]*$/;

/**
 * Builds `CALL NAME(?, NULL, ?)` from constant procedure name and argument list. null arguments
 * become the literal NULL (the SQL API binding format for NULL is not documented); every other
 * value is bound.
 */
export function buildCall(name: string, args: (Bind | null)[]): { statement: string; binds: Bind[] } {
  if (!PROC_NAME.test(name)) throw new Error(`Invalid procedure name ${name}`);
  const binds: Bind[] = [];
  const placeholders = args.map((arg) => {
    if (arg === null) return 'NULL';
    binds.push(arg);
    return '?';
  });
  return { statement: `CALL ${name}(${placeholders.join(', ')})`, binds };
}
