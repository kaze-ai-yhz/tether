import { Suspense } from "react";
import { RulesScreen } from "@/components/rules/RulesScreen";
import { StepLoader } from "@/components/StepLoader";
import { getRules } from "@/lib/data";
import { getActingAs } from "@/lib/session";

// Rules tab: Faiz's RULES (V_RULES) with RULE_EDITS history, his OVERRIDE_KEYS and
// SAFETY_LOCKED_TERMS: the bundle GET /api/rules serves, read per request as the acting role.
// Threshold edits go through POST /api/rules/:id and /api/rules/:id/preview.
export default function RulesPage() {
  return (
    <Suspense fallback={<StepLoader label="Loading rules…" />}>
      <RulesContent />
    </Suspense>
  );
}

async function RulesContent() {
  const actingAs = await getActingAs();
  return <RulesScreen result={await getRules(actingAs)} />;
}
