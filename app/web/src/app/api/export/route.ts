import { readPostBody, respond } from '@/lib/api';
import { saveExportsNow } from '@/lib/data';
import { getActingAs } from '@/lib/session';

// POST /api/export {rebuildSnapshots?: boolean} -> re-saves the EXPORT_VIEWS files from live Snowflake.
// For resets made outside the app; the app re-saves them itself after every write.
export async function POST(request: Request) {
  const actingAs = await getActingAs();
  const post = await readPostBody(request, actingAs);
  if (!post.ok) return post.response;
  const body = post.body;
  const rebuild = typeof body === 'object' && body !== null && (body as { rebuildSnapshots?: unknown }).rebuildSnapshots === true;
  return respond(await saveExportsNow(rebuild, actingAs), actingAs);
}
