import { cx } from "../cx";
import type { IllustrationName } from "./assets";
import { Illustration } from "./Illustration";
import styles from "./art.module.css";

export type PathwayCondition = "COPD" | "HTN" | "T2DM";

const PATHWAY_ART: Record<PathwayCondition, IllustrationName> = {
  COPD: "pathway-copd",
  HTN: "pathway-bp",
  T2DM: "pathway-diabetes",
};

export function isPathwayCondition(value: string | null | undefined): value is PathwayCondition {
  return value === "COPD" || value === "HTN" || value === "T2DM";
}

export interface PathwayIconProps {
  condition: PathwayCondition;
  /** Rendered size in px (square). Default 24. */
  size?: number;
  /** Accessible name. Omit when the condition is written next to the icon: it is then decorative. */
  title?: string;
  className?: string;
}

/** Care-pathway icon for a condition: COPD, hypertension (blood pressure) or type 2 diabetes. */
export function PathwayIcon({ condition, size = 24, title, className }: PathwayIconProps) {
  return (
    <Illustration
      name={PATHWAY_ART[condition]}
      width={size}
      alt={title}
      decorative={!title}
      fade={false}
      className={cx(styles.icon, className)}
    />
  );
}
