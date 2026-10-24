"use client";

import type { CSSProperties } from "react";

import { useVisualPlay } from "./use-visual-play";

/** The final CTA's ticking multiplier ("×2" → … → "×10"). Every value sits in
 *  one grid cell, so the slot is always as wide as the widest value and the
 *  line never reflows. All motion is CSS under `data-play` (closing.css):
 *  without the attribute (SSR, no JS, reduced motion) only the last value
 *  shows. `suffix` (the sentence's period) rides inside each value so it sits
 *  right after the number, not after the widest slot. Decorative: the heading carries the final text for screen readers. */
export function MultiplierTick({ values, suffix = "" }: { values: readonly string[]; suffix?: string }) {
  const ref = useVisualPlay<HTMLSpanElement>();
  const last = values.length - 1;

  return (
    <span ref={ref} className="lp-mult" aria-hidden="true">
      {values.map((v, i) => (
        <span
          key={v}
          className="lp-mult-val"
          data-pos={i === 0 ? "first" : i === last ? "last" : undefined}
          style={{ "--k": i } as CSSProperties}
        >
          {v}
          {suffix}
        </span>
      ))}
    </span>
  );
}
