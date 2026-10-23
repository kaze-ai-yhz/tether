import { respond } from '@/lib/api';
import { getQueue } from '@/lib/data';
import { getActingAs } from '@/lib/session';

// GET /api/queue: {items: V_QUEUE PENDING drafts (red flags first), held: V_HELD}.
export async function GET() {
  const actingAs = await getActingAs();
  return respond(await getQueue(actingAs), actingAs);
}
