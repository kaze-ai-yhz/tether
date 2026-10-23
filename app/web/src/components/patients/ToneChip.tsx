import { Icon, cx, toneClass, type IconName } from "@/components";
import chips from "@/components/chips.module.css";
import type { StatusTone } from "@/styles/tokens";

export interface ToneChipProps {
  tone: StatusTone;
  icon?: IconName;
  label: string;
  size?: "sm" | "md";
  title?: string;
  className?: string;
}

/** A status-style chip (word + icon + tone) for statuses StatusChip does not cover. */
export function ToneChip({ tone, icon, label, size = "sm", title, className }: ToneChipProps) {
  return (
    <span className={cx(chips.chip, chips[size], toneClass[tone], className)} title={title}>
      {icon ? <Icon name={icon} size={size === "sm" ? 12 : 14} className={chips.icon} /> : null}
      <span>{label}</span>
    </span>
  );
}
