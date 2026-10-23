import { badRequest, readPostBody, respond } from '@/lib/api';
import { reviewAction } from '@/lib/data';
import { getActingAs } from '@/lib/session';
import { parseActionId, parseReviewBody } from '@/lib/validate';

// POST /api/queue/:id/review {decision: APPROVED|EDITED|REJECTED, note, editedText}
// -> CALL TETHER_REVIEW as the acting role. As Care agent, Snowflake refuses (SNOWFLAKE_REFUSED).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actingAs = await getActingAs();
  const post = await readPostBody(request, actingAs);
  if (!post.ok) return post.response;
  const id = parseActionId((await params).id);
  if (!id.ok) return badRequest(id.message, actingAs);
  const input = parseReviewBody(post.body);
  if (!input.ok) return badRequest(input.message, actingAs);
  const { decision, note, editedText } = input.value;
  return respond(await reviewAction(id.value, decision, note, editedText, actingAs), actingAs);
}
