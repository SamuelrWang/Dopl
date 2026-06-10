"use client";

import { useLayoutEffect, useRef } from "react";

/**
 * Position a fixed, cursor-anchored popup (context menu, dropdown) so it
 * always opens fully inside the viewport.
 *
 * Returns a `ref` + initial `style` for the popup element. The element
 * first renders invisible (opacity 0 — NOT visibility:hidden, which
 * would break autoFocus inputs inside the popup) at the requested
 * coords, then a layout effect measures its real size and rewrites
 * `left`/`top` clamped to the viewport (with `margin` px of breathing
 * room) before paint — no flicker, no hardcoded size estimates. Styles
 * are mutated imperatively so there's no extra render pass.
 *
 * Usage:
 *   const { ref, style } = useClampedFixedPosition<HTMLDivElement>(x, y);
 *   return <div ref={ref} style={{ ...style, zIndex: 1000 }} ... />;
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
