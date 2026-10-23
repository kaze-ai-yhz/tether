/**
 * 3D art served from public/assets/3d/<name>.webp. Every file is rendered on the ink canvas
 * (#0A0D11) with no text or logos. Sizes are the intrinsic pixel sizes, used for the image's
 * aspect ratio before it loads; CSS keeps the real ratio once it has loaded.
 */
export const ILLUSTRATIONS = {
  "hero-tether": { width: 1600, height: 900, alt: "A glowing thread linking a home to a clinic" },
  "empty-queue": { width: 960, height: 960, alt: "A neat stack of approved cards" },
  "empty-patients": { width: 960, height: 960, alt: "A calm home with a thread leading out of it" },
  "pathway-copd": { width: 256, height: 256, alt: "Lungs with a pulse oximeter" },
  "pathway-bp": { width: 256, height: 256, alt: "Blood-pressure cuff and gauge" },
  "pathway-diabetes": { width: 256, height: 256, alt: "Glucose meter and a drop" },
  redflag: { width: 256, height: 256, alt: "Alert beacon" },
  "ai-plan": { width: 256, height: 256, alt: "A note card with one highlighted line" },
  "checkin-call": { width: 256, height: 256, alt: "A handset with sound waves" },
  "plan-check": { width: 256, height: 256, alt: "A note card with one AI Plan line accepted and one blocked" },
} as const satisfies Record<string, { width: number; height: number; alt: string }>;

export type IllustrationName = keyof typeof ILLUSTRATIONS;

export function illustrationSrc(name: IllustrationName): string {
  return `/assets/3d/${name}.webp`;
}
