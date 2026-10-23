import { badRequest, readPostBody, respond } from '@/lib/api';
import { previewRuleEdit } from '@/lib/data';
import { getActingAs } from '@/lib/session';
import { parseRuleEditBody, parseRuleId } from '@/lib/validate';

// POST /api/rules/:id/preview {field, value} -> CALL PREVIEW_RULE_EDIT (rolled back, nothing saved).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actingAs = await getActingAs();
  const post = await readPostBody(request, actingAs);
  if (!post.ok) return post.response;
  const id = parseRuleId((await params).id);
  if (!id.ok) return badRequest(id.message, actingAs);
  const input = parseRuleEditBody(post.body, false);
  if (!input.ok) return badRequest(input.message, actingAs);
  return respond(await previewRuleEdit(id.value, input.value.field, input.value.value, actingAs), actingAs);
}
