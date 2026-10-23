/**
 * Minimal browser-side JSON client for the app's route handlers, which answer
 * `{ ok, data | error, fixtures }`. Never throws: network and parse failures become `ok: false`.
 */

export interface ApiOutcome<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  /** Calm, human-readable line: the proc's `message`, the error text, or a compact JSON summary. */
  text: string;
  /** Error code from the route, e.g. SNOWFLAKE_REFUSED. */
  code: string | null;
  fixtures: boolean;
  /** The parsed response body, for a "Details" disclosure. */
  raw: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function compactJson(value: unknown, max = 180): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? "";
  } catch {
    text = String(value);
  }
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function interpret<T = unknown>(body: unknown, status: number): ApiOutcome<T> {
  if (!isRecord(body)) {
    return {
      ok: false,
      status,
      data: null,
      text: `No readable response (HTTP ${status})`,
      code: null,
      fixtures: false,
      raw: body,
    };
  }
  const fixtures = body.fixtures === true;
  if (body.ok === true) {
    const data = (body.data ?? null) as T | null;
    // Proc results are {ok, message, ...}; a proc that refuses returns ok:false inside data.
    if (isRecord(data) && data.ok === false) {
      return {
        ok: false,
        status,
        data,
        text: typeof data.message === "string" ? data.message : compactJson(data),
        code: typeof data.code === "string" ? data.code : null,
        fixtures,
        raw: body,
      };
    }
    const message = isRecord(data) && typeof data.message === "string" ? data.message : null;
    return {
      ok: true,
      status,
      data,
      text: message ?? (typeof body.message === "string" ? body.message : compactJson(data)),
      code: null,
      fixtures,
      raw: body,
    };
  }
  const error = body.error;
  const text =
    typeof error === "string"
      ? error
      : isRecord(error) && typeof error.message === "string"
        ? error.message
        : typeof body.message === "string"
          ? body.message
          : `Request failed (HTTP ${status})`;
  const code =
    isRecord(error) && typeof error.code === "string" ? error.code : typeof body.code === "string" ? body.code : null;
  return { ok: false, status, data: null, text, code, fixtures, raw: body };
}

async function request<T>(method: "GET" | "POST", url: string, payload?: unknown): Promise<ApiOutcome<T>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      cache: "no-store",
      headers: payload === undefined ? { Accept: "application/json" } : { "Content-Type": "application/json", Accept: "application/json" },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
  } catch (e) {
    return {
      ok: false,
      status: 0,
      data: null,
      text: `Network error: ${e instanceof Error ? e.message : String(e)}`,
      code: "NETWORK",
      fixtures: false,
      raw: null,
    };
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return interpret<T>(body, response.status);
}

export function getJson<T = unknown>(url: string): Promise<ApiOutcome<T>> {
  return request<T>("GET", url);
}

export function postJson<T = unknown>(url: string, payload: unknown = {}): Promise<ApiOutcome<T>> {
  return request<T>("POST", url, payload);
}
