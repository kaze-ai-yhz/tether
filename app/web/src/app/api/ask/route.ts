import { badRequest, readPostBody, respond } from '@/lib/api';
import { ask } from '@/lib/data';
import { getActingAs } from '@/lib/session';
import { parseAskBody } from '@/lib/validate';

// POST /api/ask {question} -> recorded answer from ASK_CACHE (labelled "Recorded answer").
export async function POST(request: Request) {
  const actingAs = await getActingAs();
  const post = await readPostBody(request, actingAs);
  if (!post.ok) return post.response;
  const question = parseAskBody(post.body);
  if (!question.ok) return badRequest(question.message, actingAs);
  return respond(await ask(question.value, actingAs), actingAs);
}
