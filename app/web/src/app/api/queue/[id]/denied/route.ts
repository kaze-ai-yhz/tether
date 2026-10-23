import { badRequest, readPostBody, respond } from '@/lib/api';
import { logReviewDenied } from '@/lib/data';
import { getActingAs } from '@/lib/session';
import { parseActionId } from '@/lib/validate';

// POST /api/queue/:id/denied {} -> CALL LOG_REVIEW_DENIED: audits a review Snowflake refused.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actingAs = await getActingAs();
  const post = await readPostBody(request, actingAs);
  if (!post.ok) return post.response;
  const id = parseActionId((await params).id);
  if (!id.ok) return badRequest(id.message, actingAs);
  return respond(await logReviewDenied(id.value, actingAs), actingAs);
}
