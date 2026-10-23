"use client";

import type { CSSProperties, ReactNode } from "react";
import { Button as AriaButton, type ButtonProps as AriaButtonProps } from "react-aria-components";
import { cx } from "./cx";
import { Icon, type IconName } from "./icons";
import styles from "./Button.module.css";

export type ButtonVariant = "primary" | "secondary" | "tertiary" | "destructive";

export interface ButtonProps extends Omit<AriaButtonProps, "className" | "children" | "style"> {
  /** primary = Ink fill (one per screen), secondary = outline, tertiary = text, destructive = alert outline. */
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  icon?: IconName;
  /** Icon-only buttons need an aria-label. */
  iconOnly?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  iconOnly = false,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <AriaButton
      {...rest}
      className={cx(styles.button, styles[variant], styles[size], iconOnly && styles.iconOnly, className)}
    >
      {({ isPending }) => (
        <>
          {isPending ? (
            <span className={styles.spinner} aria-hidden="true" />
          ) : icon ? (
            <Icon name={icon} size={size === "sm" ? 14 : 16} />
          ) : null}
          {iconOnly ? null : children}
        </>
      )}
    </AriaButton>
  );
}
