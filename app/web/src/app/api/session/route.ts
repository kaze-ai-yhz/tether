import { badRequest, readPostBody, respond } from '@/lib/api';
import { effectiveMode } from '@/lib/env';
import { getActingAs, setActingAs } from '@/lib/session';
import type { ActingAs, SessionInfo } from '@/lib/types';
import { parseSessionBody } from '@/lib/validate';

// GET /api/session: current Acting as. POST {actingAs: 'agent' | 'clinician'} switches it.
// The cookie only picks which role-restricted token the server uses; Snowflake enforces the gate.

function sessionInfo(actingAs: ActingAs) {
  const fixtures = effectiveMode(actingAs).mode === 'fixtures';
  return respond<SessionInfo>({ ok: true, data: { acting_as: actingAs }, fixtures }, actingAs);
}

export async function GET() {
  return sessionInfo(await getActingAs());
}

export async function POST(request: Request) {
  const current = await getActingAs();
  const post = await readPostBody(request, current);
  if (!post.ok) return post.response;
  const next = parseSessionBody(post.body);
  if (!next.ok) return badRequest(next.message, current);
  await setActingAs(next.value);
  return sessionInfo(next.value);
}
