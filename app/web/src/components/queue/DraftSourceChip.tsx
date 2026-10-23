import { ModelChip, cx } from "@/components";
import chips from "@/components/chips.module.css";
import type { DraftSource } from "@/lib/types";

export interface DraftSourceChipProps {
  source: DraftSource | null;
  /** The row's model id (V_QUEUE.model); never hard-coded. */
  model: string | null;
  size?: "sm" | "md";
}

/** Who wrote the draft: Claude (Marker), the template fallback, or the rule's fixed text (neutral). */
export function DraftSourceChip({ source, model, size = "md" }: DraftSourceChipProps) {
  if (source === "TEMPLATE") {
    return (
      <span className={cx(chips.chip, chips[size], chips.neutral)}>
        Template text: the Claude draft did not pass the drug and dose check
      </span>
    );
  }
  if (source === "RULE") {
    return <span className={cx(chips.chip, chips[size], chips.neutral)}>Fixed text from the rule</span>;
  }
  return <ModelChip model={model} source="CLAUDE" size={size} />;
}
