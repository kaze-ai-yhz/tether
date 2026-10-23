import { badRequest, readPostBody, respond } from '@/lib/api';
import { askAgent } from '@/lib/ask';
import { getActingAs } from '@/lib/session';
import { parseAskBody } from '@/lib/validate';

// POST /api/ask/agent {question} -> live Cortex Agent answer, or the recorded ASK_CACHE answer when the agent does not answer.
export async function POST(request: Request) {
  const actingAs = await getActingAs();
  const post = await readPostBody(request, actingAs);
  if (!post.ok) return post.response;
  const question = parseAskBody(post.body);
  if (!question.ok) return badRequest(question.message, actingAs);
  return respond(await askAgent(question.value, actingAs), actingAs);
}
