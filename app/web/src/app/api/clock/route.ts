import { badRequest, readPostBody, respond } from '@/lib/api';
import { advanceClock } from '@/lib/data';
import { getActingAs } from '@/lib/session';
import { parseClockBody } from '@/lib/validate';

// POST /api/clock {days: 0|1|2|5|10|21} -> CALL ADVANCE_CLOCK (simulated clock; 0 = next ladder event).
export async function POST(request: Request) {
  const actingAs = await getActingAs();
  const post = await readPostBody(request, actingAs);
  if (!post.ok) return post.response;
  const days = parseClockBody(post.body);
  if (!days.ok) return badRequest(days.message, actingAs);
  return respond(await advanceClock(days.value, actingAs), actingAs);
}
