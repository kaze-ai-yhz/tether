import { cx } from "./cx";
import { Icon, type IconName } from "./icons";
import type { StatusTone } from "@/styles/tokens";
import styles from "./chips.module.css";

/** Patient display statuses, exactly as V_PATIENT_LIST.display_status emits them. */
export type DisplayStatus =
  | "Needs clinician"
  | "Awaiting approval"
  | "Action taken"
  | "Pending"
  | "Ongoing follow-up"
  | "Complete"
  | "Scheduled"
  | "Visited · no AI Plan";

/** ACTION_QUEUE.status values. */
export type DraftStatus = "PENDING" | "APPROVED" | "EDITED" | "REJECTED" | "SENT";

/** URGENT = red-flag alert (the one filled alert element on a screen). */
export type ChipStatus = DisplayStatus | DraftStatus | "URGENT";

interface StatusSpec {
  label: string;
  tone: StatusTone;
  icon: IconName;
}

export const STATUS_SPEC: Record<ChipStatus, StatusSpec> = {
  "Needs clinician": { label: "Needs clinician", tone: "alert", icon: "triangle" },
  "Awaiting approval": { label: "Awaiting approval", tone: "caution", icon: "eye" },
  "Action taken": { label: "Action taken", tone: "info", icon: "send" },
  Pending: { label: "Pending", tone: "info", icon: "clock" },
  "Ongoing follow-up": { label: "Ongoing follow-up", tone: "info", icon: "pulse" },
  Complete: { label: "Complete", tone: "ok", icon: "circleCheck" },
  Scheduled: { label: "Scheduled", tone: "neutral", icon: "calendar" },
  "Visited · no AI Plan": { label: "Visited · no AI Plan", tone: "neutral", icon: "circleDashed" },
  PENDING: { label: "Pending approval", tone: "caution", icon: "eye" },
  APPROVED: { label: "Approved", tone: "ok", icon: "check" },
  EDITED: { label: "Approved with edits", tone: "ok", icon: "pencil" },
  REJECTED: { label: "Rejected", tone: "neutral", icon: "circleX" },
  SENT: { label: "Sent", tone: "info", icon: "send" },
  URGENT: { label: "Red flag", tone: "alert-strong", icon: "triangle" },
};

const UNKNOWN_SPEC: Omit<StatusSpec, "label"> = { tone: "neutral", icon: "circleDashed" };

export const toneClass: Record<StatusTone, string> = {
  ok: styles.ok,
  info: styles.info,
  caution: styles.caution,
  alert: styles.alert,
  "alert-strong": styles.alertStrong,
  neutral: styles.neutral,
};

export function statusSpec(status: string): StatusSpec {
  return (STATUS_SPEC as Record<string, StatusSpec>)[status] ?? { ...UNKNOWN_SPEC, label: status };
}

export interface StatusChipProps {
  /** A display status, a draft status, or "URGENT". Unknown values render neutral with the raw text. */
  status: ChipStatus | (string & {});
  size?: "sm" | "md";
  /** Overrides the word (keep it the same meaning). */
  label?: string;
  className?: string;
}

/** Status = word + distinct-shape icon + color (DESIGN-SYSTEM §2.3). */
export function StatusChip({ status, size = "md", label, className }: StatusChipProps) {
  const spec = statusSpec(status);
  return (
    <span className={cx(styles.chip, styles[size], toneClass[spec.tone], className)} data-status={status}>
      <Icon name={spec.icon} size={size === "sm" ? 12 : 14} className={styles.icon} />
      <span>{label ?? spec.label}</span>
    </span>
  );
}
