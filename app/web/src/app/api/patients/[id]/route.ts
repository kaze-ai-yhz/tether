import { badRequest, respond } from '@/lib/api';
import { getPatientDetail } from '@/lib/data';
import { getActingAs } from '@/lib/session';
import { parsePatientId } from '@/lib/validate';

// GET /api/patients/:id: one V_PATIENT_DETAIL row (404 if the SYN id is not in the record).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actingAs = await getActingAs();
  const id = parsePatientId((await params).id);
  if (!id.ok) return badRequest(id.message, actingAs);
  return respond(await getPatientDetail(id.value, actingAs), actingAs);
}
