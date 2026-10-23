import { respond } from '@/lib/api';
import { getPatients } from '@/lib/data';
import { getActingAs } from '@/lib/session';

// GET /api/patients: V_PATIENT_LIST ordered by status rank.
export async function GET() {
  const actingAs = await getActingAs();
  return respond(await getPatients(actingAs), actingAs);
}
