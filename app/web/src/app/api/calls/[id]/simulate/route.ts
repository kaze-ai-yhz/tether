import { badRequest, readPostBody, respond } from '@/lib/api';
import { simulateCall } from '@/lib/data';
import { getActingAs } from '@/lib/session';
import { parseActionId, parseSimulateBody } from '@/lib/validate';

// POST /api/calls/:id/simulate {scenario: ANSWERED|NO_ANSWER|CHEST_PAIN} -> CALL SIMULATE_CHECKIN_CALL.
// :id is the action id of a SENT AI check-in call. The call is simulated and labelled so.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actingAs = await getActingAs();
  const post = await readPostBody(request, actingAs);
  if (!post.ok) return post.response;
  const id = parseActionId((await params).id);
  if (!id.ok) return badRequest(id.message, actingAs);
  const scenario = parseSimulateBody(post.body);
  if (!scenario.ok) return badRequest(scenario.message, actingAs);
  return respond(await simulateCall(id.value, scenario.value, actingAs), actingAs);
}
