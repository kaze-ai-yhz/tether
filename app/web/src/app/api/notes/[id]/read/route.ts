import { badRequest, readPostBody, respond } from '@/lib/api';
import { readAiPlan } from '@/lib/data';
import { getActingAs } from '@/lib/session';
import { parseNoteId } from '@/lib/validate';

// POST /api/notes/:id/read {} -> CALL READ_AI_PLAN(note_id). id 'all' reads every patient's latest AI Plan.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actingAs = await getActingAs();
  const post = await readPostBody(request, actingAs);
  if (!post.ok) return post.response;
  const id = parseNoteId((await params).id);
  if (!id.ok) return badRequest(id.message, actingAs);
  return respond(await readAiPlan(id.value, actingAs), actingAs);
}
