import { badRequest, readPostBody, respond } from '@/lib/api';
import { updateRule } from '@/lib/data';
import { getActingAs } from '@/lib/session';
import { parseRuleEditBody, parseRuleId } from '@/lib/validate';

// POST /api/rules/:id {field, value, reason} -> CALL UPDATE_RULE (clinician role only, audited).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actingAs = await getActingAs();
  const post = await readPostBody(request, actingAs);
  if (!post.ok) return post.response;
  const id = parseRuleId((await params).id);
  if (!id.ok) return badRequest(id.message, actingAs);
  const input = parseRuleEditBody(post.body, true);
  if (!input.ok) return badRequest(input.message, actingAs);
  const { field, value, reason } = input.value;
  return respond(await updateRule(id.value, field, value, reason, actingAs), actingAs);
}
