import { badRequest, respond } from '@/lib/api';
import { getTimeline } from '@/lib/data';
import { getActingAs } from '@/lib/session';
import { parsePatientId } from '@/lib/validate';

// GET /api/patients/:id/timeline: V_TIMELINE (audit events for the patient), newest first.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actingAs = await getActingAs();
  const id = parsePatientId((await params).id);
  if (!id.ok) return badRequest(id.message, actingAs);
  return respond(await getTimeline(id.value, actingAs), actingAs);
}
