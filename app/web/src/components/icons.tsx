import type { ReactNode, SVGProps } from "react";

/**
 * Inline 16 px stroke icons. Status icons differ in shape (DESIGN-SYSTEM §2.3) so status survives
 * grayscale. Decorative by default (aria-hidden); the word next to the icon carries the meaning.
 */
export type IconName =
  | "triangle"
  | "eye"
  | "send"
  | "clock"
  | "pulse"
  | "circleCheck"
  | "check"
  | "calendar"
  | "circleDashed"
  | "pencil"
  | "circleX"
  | "queue"
  | "patients"
  | "rules"
  | "chevronLeft"
  | "chevronRight"
  | "close"
  | "ask"
  | "info"
  | "reset";

interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  size?: number;
  title?: string;
}

const paths: Record<IconName, ReactNode> = {
  triangle: (
    <>
      <path d="M8 2.2 14.3 13.3H1.7L8 2.2Z" strokeLinejoin="round" />
      <path d="M8 6.5v3.2" strokeLinecap="round" />
      <circle cx="8" cy="11.5" r="0.6" fill="currentColor" stroke="none" />
    </>
  ),
  eye: (
    <>
      <path d="M1.5 8S3.8 3.8 8 3.8 14.5 8 14.5 8 12.2 12.2 8 12.2 1.5 8 1.5 8Z" strokeLinejoin="round" />
      <circle cx="8" cy="8" r="2" />
    </>
  ),
  send: (
    <>
      <path d="M14 2 6.8 9.2" strokeLinecap="round" />
      <path d="M14 2 9.6 14l-2.8-4.8L2 6.4 14 2Z" strokeLinejoin="round" />
    </>
  ),
  clock: (
    <>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M8 4.6V8l2.4 1.6" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  pulse: <path d="M1.5 8.5h3l1.6-4.5 3.2 8.5 1.7-4h3.5" strokeLinecap="round" strokeLinejoin="round" />,
  circleCheck: (
    <>
      <circle cx="8" cy="8" r="6.2" />
      <path d="m5.2 8.2 2 2 3.8-4.3" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  check: <path d="m3 8.6 3.2 3.1L13 4.4" strokeLinecap="round" strokeLinejoin="round" />,
  calendar: (
    <>
      <rect x="2" y="3.2" width="12" height="10.8" rx="1.2" />
      <path d="M2 6.6h12M5.2 1.8v2.6M10.8 1.8v2.6" strokeLinecap="round" />
    </>
  ),
  circleDashed: (
    <>
      <circle cx="8" cy="8" r="6.2" strokeDasharray="2 2.2" />
      <path d="M5.4 8h5.2" strokeLinecap="round" />
    </>
  ),
  pencil: (
    <>
      <path d="M10.6 2.6 13.4 5.4 5.6 13.2 2.4 13.6l.4-3.2 7.8-7.8Z" strokeLinejoin="round" />
      <path d="m9.2 4 2.8 2.8" />
    </>
  ),
  circleX: (
    <>
      <circle cx="8" cy="8" r="6.2" />
      <path d="m5.8 5.8 4.4 4.4M10.2 5.8l-4.4 4.4" strokeLinecap="round" />
    </>
  ),
  queue: (
    <>
      <path d="M2 9.5h3.2l1 1.8h3.6l1-1.8H14" strokeLinejoin="round" />
      <path d="M3.6 3h8.8L14 9.5V13H2V9.5L3.6 3Z" strokeLinejoin="round" />
    </>
  ),
  patients: (
    <>
      <circle cx="6" cy="5.4" r="2.4" />
      <path d="M1.8 13.4c.4-2.4 2.1-3.8 4.2-3.8s3.8 1.4 4.2 3.8" strokeLinecap="round" />
      <path d="M10.6 3.2a2.4 2.4 0 0 1 0 4.4M12 9.9c1.2.5 2 1.7 2.2 3.5" strokeLinecap="round" />
    </>
  ),
  rules: (
    <>
      <path d="M2.5 4h11M2.5 8h11M2.5 12h11" strokeLinecap="round" />
      <circle cx="5.5" cy="4" r="1.3" fill="var(--surface-default)" />
      <circle cx="10.5" cy="8" r="1.3" fill="var(--surface-default)" />
      <circle cx="7" cy="12" r="1.3" fill="var(--surface-default)" />
    </>
  ),
  chevronLeft: <path d="M10 3.5 5.5 8l4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />,
  chevronRight: <path d="M6 3.5 10.5 8 6 12.5" strokeLinecap="round" strokeLinejoin="round" />,
  close: <path d="m4 4 8 8M12 4l-8 8" strokeLinecap="round" />,
  ask: (
    <>
      <path d="M2.2 3.4h11.6v7.4H8.4L5 13.4v-2.6H2.2V3.4Z" strokeLinejoin="round" />
      <path d="M5 6.2h6M5 8.2h3.6" strokeLinecap="round" />
    </>
  ),
  info: (
    <>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M8 7.2v4" strokeLinecap="round" />
      <circle cx="8" cy="5" r="0.6" fill="currentColor" stroke="none" />
    </>
  ),
  reset: (
    <>
      <path d="M2.8 8a5.2 5.2 0 1 0 1.6-3.8" strokeLinecap="round" />
      <path d="M2.6 2.4v2.8h2.8" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
};

export function Icon({ name, size = 16, title, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      focusable="false"
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {paths[name]}
    </svg>
  );
}
