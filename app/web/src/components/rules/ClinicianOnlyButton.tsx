"use client";

import type { ReactNode } from "react";
import { Focusable, Tooltip, TooltipTrigger } from "react-aria-components";
import { Button, type ButtonVariant } from "../Button";
import buttonStyles from "../Button.module.css";
import { cx } from "../cx";
import { Icon, type IconName } from "../icons";
import styles from "./rules.module.css";

export interface ClinicianOnlyButtonProps {
  /** False when acting as Care agent: the button shows as disabled and explains why in a tooltip. */
  allowed: boolean;
  /** Tooltip text while not allowed. */
  deniedReason: string;
  onPress: () => void;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: "sm" | "md";
  icon?: IconName;
  "aria-label"?: string;
}

/**
 * A button only a clinician can use. When not allowed it stays focusable (aria-disabled) so the
 * tooltip can say why; the gate itself is the role's grants in Snowflake.
 */
export function ClinicianOnlyButton({
  allowed,
  deniedReason,
  onPress,
  children,
  variant = "secondary",
  size = "sm",
  icon,
  "aria-label": ariaLabel,
}: ClinicianOnlyButtonProps) {
  if (allowed) {
    return (
      <Button variant={variant} size={size} icon={icon} onPress={onPress} aria-label={ariaLabel}>
        {children}
      </Button>
    );
  }
  return (
    <TooltipTrigger delay={250} closeDelay={100}>
      <Focusable>
        <span
          role="button"
          aria-disabled="true"
          aria-label={ariaLabel}
          data-disabled="true"
          className={cx(buttonStyles.button, buttonStyles[variant], buttonStyles[size])}
        >
          {icon ? <Icon name={icon} size={size === "sm" ? 14 : 16} /> : null}
          {children}
        </span>
      </Focusable>
      <Tooltip className={styles.tooltip} offset={6}>
        {deniedReason}
      </Tooltip>
    </TooltipTrigger>
  );
}
