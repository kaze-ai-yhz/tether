import Image from "next/image";
import { cx } from "../cx";
import { ILLUSTRATIONS, illustrationSrc, type IllustrationName } from "./assets";
import styles from "./art.module.css";

export interface IllustrationProps {
  name: IllustrationName;
  /** Rendered width in px. Height follows the asset's aspect ratio. Defaults to the intrinsic width. */
  width?: number;
  /** Alt text; defaults to a plain description of the asset. Ignored when decorative. */
  alt?: string;
  /** True when nearby text already says what the image shows: empty alt, hidden from assistive tech. */
  decorative?: boolean;
  /** Fade in after the surrounding text (motion-art). Default true. */
  fade?: boolean;
  /** Load immediately instead of lazily (only for art above the fold). */
  eager?: boolean;
  className?: string;
}

/** One 3D illustration from public/assets/3d, sized, lazy by default, faded in after its text. */
export function Illustration({
  name,
  width,
  alt,
  decorative = false,
  fade = true,
  eager = false,
  className,
}: IllustrationProps) {
  const asset = ILLUSTRATIONS[name];
  const renderWidth = width ?? asset.width;
  const renderHeight = Math.round((renderWidth * asset.height) / asset.width);
  return (
    <Image
      src={illustrationSrc(name)}
      width={renderWidth}
      height={renderHeight}
      alt={decorative ? "" : (alt ?? asset.alt)}
      aria-hidden={decorative ? true : undefined}
      loading={eager ? "eager" : "lazy"}
      unoptimized
      draggable={false}
      className={cx(styles.art, fade && "motion-art", className)}
    />
  );
}
