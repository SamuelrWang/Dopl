"use client";

import { useLayoutEffect, useRef } from "react";

/**
 * Position a fixed, cursor-anchored popup so it always opens fully inside the
 * viewport. Returns `ref` + initial `style`.
 *
 * The element renders invisible at the requested coords, then a layout effect
 * measures and rewrites `left`/`top` clamped to the viewport (with `margin` px)
 * before paint. ⚠ opacity 0, NOT visibility:hidden — the latter breaks autoFocus
 * inputs inside the popup. ⚠ Styles are mutated imperatively so there is no
 * extra render pass.
 */
export function useClampedFixedPosition<T extends HTMLElement>(
  x: number,
  y: number,
  margin = 8,
) {
  const ref = useRef<T | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const left = Math.max(margin, Math.min(x, window.innerWidth - width - margin));
    const top = Math.max(margin, Math.min(y, window.innerHeight - height - margin));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.opacity = "";
  }, [x, y, margin]);

  return {
    ref,
    style: {
      position: "fixed",
      left: x,
      top: y,
      opacity: 0,
    } as const satisfies React.CSSProperties,
  };
}
