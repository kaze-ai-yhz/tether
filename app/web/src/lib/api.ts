import 'server-only';

import { NextResponse } from 'next/server';

import { effectiveMode } from './env';
import type { ActingAs, ApiResponse, DataResult, ErrorCode } from './types';

// Helpers shared by the /api route handlers: the {ok, data|error, fixtures, acting_as} envelope
// and a guard for POST bodies.

const HTTP_STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  DECLINED: 409,
  SNOWFLAKE_REFUSED: 403,
  ROLE_REFUSED: 403,
  SNOWFLAKE_ERROR: 502,
  TIMEOUT: 504,
};

const MAX_BODY_CHARS = 16_000;

export function respond<T>(result: DataResult<T>, actingAs: ActingAs): NextResponse<ApiResponse<T>> {
  const body = { ...result, acting_as: actingAs } as ApiResponse<T>;
  return NextResponse.json(body, {
    status: result.ok ? 200 : HTTP_STATUS[result.error.code],
    headers: { 'Cache-Control': 'no-store' },
  });
}

export function badRequest(message: string, actingAs: ActingAs): NextResponse<ApiResponse<never>> {
  const fixtures = effectiveMode(actingAs).mode === 'fixtures';
  return respond<never>({ ok: false, error: { code: 'BAD_REQUEST', message }, fixtures }, actingAs);
}

function isSameOrigin(request: Request): boolean {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
  const origin = request.headers.get('origin');
  if (!origin) return true; // curl and same-origin navigations may omit it
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Every POST must be same-origin and send Content-Type: application/json (the body may be {}).
 * A JSON content type forces a CORS preflight, so another site cannot post on the user's behalf.
 */
export async function readPostBody(
  request: Request,
  actingAs: ActingAs,
): Promise<{ ok: true; body: unknown } | { ok: false; response: NextResponse<ApiResponse<never>> }> {
  if (!isSameOrigin(request)) {
    return { ok: false, response: badRequest('Requests must come from the Tether app itself.', actingAs) };
  }
  const type = request.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('application/json')) {
    return { ok: false, response: badRequest('Send the request as JSON (Content-Type: application/json).', actingAs) };
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY_CHARS) {
    return { ok: false, response: badRequest('The request body is too large.', actingAs) };
  }
  if (!raw.trim()) return { ok: true, body: {} };
  try {
    return { ok: true, body: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false, response: badRequest('The request body is not valid JSON.', actingAs) };
  }
}
