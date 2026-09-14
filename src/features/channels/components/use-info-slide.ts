"use client";

/**
 * THE INFO COLUMN OUTLIVES `infoOpen` BY ONE TRANSITION, so the closing slide
 * has something to clip.
 *
 * ⚠ SPLIT OUT OF `channel-surface.tsx` ON 2026-09-04, at the 500-line cap, when
 * the web's single-column layout needed room in that file. Nothing inside
 * changed in the move; every ⚠ below is that file's.
 *
 * Presentation only — the caller's `infoOpen` stays the single source of truth
 * for the toggle, and the OR below means this can never hold the column open,
 * only briefly populated. Same shape as `Popover`'s exit phase.
 */

import { useEffect, useState } from "react";

/** The info column stays mounted this long after close so its slide can run.
 *  ⚠ Keep in sync with `.channel-info-slide`'s transition (globals.css + the
 *  desktop `kit.css` copy). */
const INFO_SLIDE_MS = 200;

/** `true` while the panel must be RENDERED — open, or one transition past close. */
export function useInfoSlide(infoOpen: boolean): boolean {
  // ⚠ THE ONLY setState IS INSIDE THE TIMER, and OPENING schedules a 0ms one it
  // does not need — because mounting is already handled by the OR below. Both
  // are deliberate: `react-hooks/set-state-in-effect` (error, not warning)
  // rejects a synchronous setState in an effect body, and a 0ms timer is how the
  // same machine serves the open direction and the reduced-motion escape, where
  // the kit turns the transition off and nothing may wait for it.
  const [trailing, setTrailing] = useState(infoOpen);
  useEffect(() => {
    if (trailing === infoOpen) return;
    const instant =
      infoOpen ||
      (typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const timer = setTimeout(
      () => setTrailing(infoOpen),
      instant ? 0 : INFO_SLIDE_MS
    );
    return () => clearTimeout(timer);
  }, [infoOpen, trailing]);
  return infoOpen || trailing;
}
