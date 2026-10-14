"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { GlassCardContext } from "@/shared/layout/auth-split";

type CardRect = GlassCardContext["regions"]["main"];

/**
 * Fit a panel laid out at PRODUCT size into a rect on step 4's card, filling
 * the rect's WIDTH exactly (Samuel 2026-10-13: no white space on the right).
 *
 * The scale comes from the height (the panel's measured natural height must
 * fit) and from a floor on the natural width (`minW`, so the product layout
 * never squeezes narrower than it can hold); the natural width is then
 * whatever makes `width × scale === rect.w`. So the panel's content stretches
 * sideways rather than leaving a gap.
 */
export function useFitToRect(
  rect: CardRect,
  minW: number,
  maxScale: number,
  /**
   * FILL mode: the panel's smallest natural height. The scale then comes from
   * this floor (not a measured height), and the panel is given the natural
   * height `rect.h / scale`, so it fills the rect's HEIGHT as well as its
   * width — its own flex layout spends the extra (Samuel 2026-10-13: no empty
   * band above and below the identity cards).
   */
  fillMinH?: number
) {
  const ref = useRef<HTMLDivElement>(null);
  const [natH, setNatH] = useState(260);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // `offsetHeight` ignores the transform: the natural, unscaled height.
    const read = () => setNatH(el.offsetHeight || 260);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = Math.max(0.2, Math.min(maxScale, rect.h / (fillMinH ?? natH), rect.w / minW));
  const width = rect.w / scale;
  const style = {
    position: "absolute",
    left: rect.x,
    top: rect.y + rect.h / 2,
    width,
    height: fillMinH === undefined ? undefined : rect.h / scale,
    transform: `translateY(-50%) scale(${scale.toFixed(4)})`,
    transformOrigin: "left center",
    pointerEvents: "none",
  } as const;
  return { ref, style };
}
