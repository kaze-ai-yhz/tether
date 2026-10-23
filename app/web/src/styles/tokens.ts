/**
 * Tether design tokens for TypeScript (docs/tether/DESIGN-SYSTEM.md §2-6).
 * Mirrors src/styles/tokens.css; components should prefer the CSS variables in `cssVar`
 * so the theme switch keeps working. Raw hex values are here for SVG exports and checks.
 */

export type ThemeName = "dark" | "light";

export type StatusTone = "ok" | "info" | "caution" | "alert" | "alert-strong" | "neutral";

interface StatusSet {
  fg: string;
  bg: string;
  border: string;
}

interface ThemeColors {
  surface: { canvas: string; default: string; raised: string; sunken: string; hover: string };
  line: { hairline: string; strong: string; boundary: string };
  text: { default: string; onInk: string; muted: string; disabled: string };
  marker: { text: string; mark: string; wash: string };
  status: {
    ok: StatusSet;
    info: StatusSet;
    caution: StatusSet;
    alert: StatusSet;
    alertStrong: { fg: string; bg: string };
    neutral: StatusSet;
  };
  series: [string, string, string];
  overdue: [string, string, string, string, string];
  shadowRaised: string;
}

export const colors: Record<ThemeName, ThemeColors> = {
  dark: {
    surface: { canvas: "#0A0D11", default: "#11151B", raised: "#171C23", sunken: "#07090C", hover: "#1D232B" },
    line: { hairline: "#252B34", strong: "#363A41", boundary: "#6A7482" },
    text: { default: "#E7EAEE", onInk: "#0A0D11", muted: "#98A1AC", disabled: "#4A525E" },
    marker: { text: "#CFEA55", mark: "#CFEA55", wash: "#1E2510" },
    status: {
      ok: { fg: "#56CFA8", bg: "#0E2620", border: "#2A6B58" },
      info: { fg: "#7FA9EE", bg: "#0F1A2B", border: "#2C4A78" },
      caution: { fg: "#F0B45A", bg: "#2A1F0E", border: "#7A5524" },
      alert: { fg: "#FF6B8B", bg: "#2B1219", border: "#7D2E42" },
      alertStrong: { fg: "#0A0D11", bg: "#FF6B8B" },
      neutral: { fg: "#98A1AC", bg: "#07090C", border: "#363A41" },
    },
    series: ["#5A8EE4", "#D75F94", "#884BAF"],
    overdue: ["#7A4627", "#9C562C", "#C86D34", "#E9884D", "#FDAB7C"],
    shadowRaised: "none",
  },
  light: {
    surface: { canvas: "#F5F6F7", default: "#FFFFFF", raised: "#FFFFFF", sunken: "#ECEEF1", hover: "#ECEEF1" },
    line: { hairline: "#D5D9DF", strong: "#B9C0C9", boundary: "#7F8895" },
    text: { default: "#10141A", onInk: "#F5F6F7", muted: "#535C68", disabled: "#9AA2AD" },
    marker: { text: "#4D6000", mark: "#7A9A00", wash: "#EEF6CF" },
    status: {
      ok: { fg: "#1C7445", bg: "#E7F3EC", border: "#8FC4A6" },
      info: { fg: "#1762B6", bg: "#E8F0FA", border: "#9DBDE6" },
      caution: { fg: "#8F3E00", bg: "#FBF0E6", border: "#E6A782" },
      alert: { fg: "#B0213A", bg: "#FBEAED", border: "#E29AA8" },
      alertStrong: { fg: "#FFFFFF", bg: "#B0213A" },
      neutral: { fg: "#535C68", bg: "#ECEEF1", border: "#B9C0C9" },
    },
    series: ["#1762B6", "#902559", "#BF75D0"],
    overdue: ["#E6A782", "#DA8956", "#CA6D2B", "#B15300", "#8F3E00"],
    shadowRaised: "0 1px 2px rgba(16,20,26,.06), 0 8px 24px rgba(16,20,26,.08)",
  },
};

/** CSS custom property references, theme-aware. */
export const cssVar = {
  surface: {
    canvas: "var(--surface-canvas)",
    default: "var(--surface-default)",
    raised: "var(--surface-raised)",
    sunken: "var(--surface-sunken)",
    hover: "var(--surface-hover)",
  },
  line: {
    hairline: "var(--line-hairline)",
    strong: "var(--line-strong)",
    boundary: "var(--line-boundary)",
  },
  text: {
    default: "var(--text-default)",
    onInk: "var(--text-on-ink)",
    muted: "var(--text-muted)",
    disabled: "var(--text-disabled)",
  },
  ink: "var(--ink)",
  marker: { text: "var(--marker-text)", mark: "var(--marker-mark)", wash: "var(--marker-wash)" },
  status: (tone: StatusTone) =>
    tone === "alert-strong"
      ? { fg: "var(--status-alert-strong-fg)", bg: "var(--status-alert-strong-bg)", border: "var(--status-alert-strong-bg)" }
      : { fg: `var(--status-${tone}-fg)`, bg: `var(--status-${tone}-bg)`, border: `var(--status-${tone}-border)` },
  series: ["var(--series-1)", "var(--series-2)", "var(--series-3)"] as const,
  overdue: ["var(--overdue-1)", "var(--overdue-2)", "var(--overdue-3)", "var(--overdue-4)", "var(--overdue-5)"] as const,
  shadowRaised: "var(--shadow-raised)",
} as const;

export const font = {
  sans: "var(--font-sans)",
  serif: "var(--font-serif)",
  mono: "var(--font-mono)",
} as const;

/** Size / line height in px, weight (DESIGN-SYSTEM §3). */
export const type = {
  display: { size: 56, line: 60, weight: 400, family: "serif" },
  h1: { size: 32, line: 38, weight: 400, family: "serif" },
  h2: { size: 22, line: 28, weight: 600, family: "sans" },
  h3: { size: 16, line: 22, weight: 600, family: "sans" },
  body: { size: 14, line: 20, weight: 400, family: "sans" },
  meta: { size: 12, line: 16, weight: 500, family: "sans" },
  readout: { size: 28, line: 32, weight: 600, family: "sans", unitScale: 0.6 },
  mono: { size: 13, line: 18, weight: 400, family: "mono" },
} as const;

/** Space scale in px (DESIGN-SYSTEM §4). */
export const space = [0, 1, 2, 4, 8, 12, 16, 24, 32, 40, 48, 64, 80, 96] as const;
export const gap = { control: 8, card: 16, cards: 24, pageMargin: 32 } as const;

export const radius = { chip: 2, control: 4, card: 6, dialog: 8, pill: 999 } as const;

export const hitTarget = { desktop: 24, touch: 40 } as const;

/** Layout regions in px (DESIGN-SYSTEM §5). */
export const layout = {
  topBar: 48,
  rail: 56,
  railExpanded: 224,
  inspector: 400,
  inspectorMin: 360,
  inspectorMax: 560,
  demoPanel: 360,
  askDrawer: 440,
  actionBar: 64,
  contentMax: 1600,
  gutter: 24,
  margin: 32,
  breakpoints: [768, 1024, 1280, 1600],
} as const;

/** Durations in ms and easings (DESIGN-SYSTEM §6). */
export const motion = {
  press: 60,
  hover: 80,
  toggle: 120,
  reveal: 180,
  panel: 240,
  dialog: 320,
  settle: 900,
  reducedFade: 200,
} as const;

export const easing = {
  conduct: "cubic-bezier(0.2, 0, 0, 1)",
  exit: "cubic-bezier(0.4, 0, 1, 1)",
  standard: "cubic-bezier(0.3, 0, 0.2, 1)",
} as const;

/** SVG stroke-dasharray per provenance (DESIGN-SYSTEM §2.5). */
export const dash = {
  recorded: undefined,
  proposed: "4 3",
  simulated: "6 3 1 3",
  notConnected: "1 3",
} as const;

export const focusRing = { width: 2, offset: 2 } as const;
