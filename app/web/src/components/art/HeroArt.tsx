"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import { cx } from "../cx";
import { ILLUSTRATIONS, illustrationSrc } from "./assets";
import styles from "./art.module.css";

/** Largest drift in px, in any direction. */
const MAX_SHIFT = 6;
/** Share of the remaining distance covered per 60 Hz frame: a very slow drift. */
const FOLLOW = 0.035;

export interface HeroArtProps {
  /** Size the band with this class (height, width, mask). */
  className?: string;
  /** Alt text. Default empty: the art is decorative next to the page title. */
  alt?: string;
}

/**
 * The hero-tether art, cropped to fill its box and faded into the canvas at the edges. On a fine
 * pointer it drifts up to 6 px away from the pointer; off for reduced motion and touch.
 */
export function HeroArt({ className, alt = "" }: HeroArtProps) {
  const layerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = layerRef.current;
    if (!node) return;
    const layer: HTMLDivElement = node;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    let frame = 0;
    let last = 0;
    let targetX = 0;
    let targetY = 0;
    let x = 0;
    let y = 0;
    let listening = false;

    function step(now: number) {
      const frames = last ? Math.min((now - last) / (1000 / 60), 4) : 1;
      last = now;
      const k = 1 - Math.pow(1 - FOLLOW, frames);
      x += (targetX - x) * k;
      y += (targetY - y) * k;
      const settled = Math.abs(targetX - x) < 0.02 && Math.abs(targetY - y) < 0.02;
      if (settled) {
        x = targetX;
        y = targetY;
      }
      layer.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
      frame = settled ? 0 : requestAnimationFrame(step);
      if (settled) last = 0;
    }

    function onPointerMove(event: PointerEvent) {
      if (event.pointerType !== "mouse") return;
      let dx = (event.clientX / window.innerWidth) * 2 - 1;
      let dy = (event.clientY / window.innerHeight) * 2 - 1;
      const length = Math.hypot(dx, dy);
      if (length > 1) {
        dx /= length;
        dy /= length;
      }
      // Drift away from the pointer, so the art reads as sitting behind the page.
      targetX = -dx * MAX_SHIFT;
      targetY = -dy * MAX_SHIFT;
      if (!frame) frame = requestAnimationFrame(step);
    }

    function sync() {
      const enabled = !reduce.matches && finePointer.matches;
      if (enabled && !listening) {
        window.addEventListener("pointermove", onPointerMove, { passive: true });
        listening = true;
      } else if (!enabled && listening) {
        window.removeEventListener("pointermove", onPointerMove);
        listening = false;
        cancelAnimationFrame(frame);
        frame = 0;
        last = 0;
        targetX = targetY = x = y = 0;
        layer.style.transform = "";
      }
    }

    sync();
    reduce.addEventListener("change", sync);
    finePointer.addEventListener("change", sync);
    return () => {
      reduce.removeEventListener("change", sync);
      finePointer.removeEventListener("change", sync);
      window.removeEventListener("pointermove", onPointerMove);
      cancelAnimationFrame(frame);
    };
  }, []);

  const asset = ILLUSTRATIONS["hero-tether"];
  return (
    <div className={cx(styles.hero, className)} aria-hidden={alt ? undefined : true}>
      <div ref={layerRef} className={styles.heroLayer}>
        <Image
          src={illustrationSrc("hero-tether")}
          alt={alt}
          fill
          sizes={`${asset.width}px`}
          loading="eager"
          unoptimized
          draggable={false}
          className={cx(styles.heroImage, "motion-art")}
        />
      </div>
    </div>
  );
}
