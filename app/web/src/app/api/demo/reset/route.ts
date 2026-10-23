import { readPostBody, respond } from '@/lib/api';
import { demoReset } from '@/lib/data';
import { getActingAs } from '@/lib/session';

// POST /api/demo/reset {} -> CALL DEMO_RESET (restores the demo tables from their snapshots).
export async function POST(request: Request) {
  const actingAs = await getActingAs();
  const post = await readPostBody(request, actingAs);
  if (!post.ok) return post.response;
  return respond(await demoReset(actingAs), actingAs);
}
