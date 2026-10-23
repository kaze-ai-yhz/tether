import { respond } from '@/lib/api';
import { getState } from '@/lib/data';
import { getActingAs } from '@/lib/session';

// GET /api/state: V_APP_STATE (simulated date, counts, roles mode, model ids, call_ready).
export async function GET() {
  const actingAs = await getActingAs();
  return respond(await getState(actingAs), actingAs);
}
