import { respond } from '@/lib/api';
import { getRules } from '@/lib/data';
import { getActingAs } from '@/lib/session';

// GET /api/rules: {rules: V_RULES, edits: RULE_EDITS, override_keys, safety_locked_terms}.
export async function GET() {
  const actingAs = await getActingAs();
  return respond(await getRules(actingAs), actingAs);
}
