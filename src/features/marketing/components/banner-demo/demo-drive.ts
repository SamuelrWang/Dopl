/**
 * What drives the hero demo's step (experiment, 2026-10-15).
 *
 * `time`   — the original: per-step timeouts, looping (use-demo-timeline.ts).
 * `scroll` — scroll position IS progress: scrolling down advances the steps,
 *            scrolling up reverses them. The scene track gets taller to give
 *            the demo its own scroll range (marketing.css, `data-demo`).
 *
 * Flip DEFAULT_DEMO_DRIVE to restore the old behaviour for everyone; append
 * `?demo=time` or `?demo=scroll` to the URL to compare without a code change.
 */
export type DemoDrive = "time" | "scroll";

export const DEFAULT_DEMO_DRIVE: DemoDrive = "scroll";

/** Client-only. Server / no `window` falls back to the default. */
export function readDemoDrive(): DemoDrive {
  if (typeof window === "undefined") return DEFAULT_DEMO_DRIVE;
  const q = new URLSearchParams(window.location.search).get("demo");
  return q === "time" || q === "scroll" ? q : DEFAULT_DEMO_DRIVE;
}

/**
 * Extra scroll track for the demo, in viewport heights, on top of the banner's
 * own intro range. ~40 beats over 900vh is roughly one beat per two wheel notches.
 * Mirrored by `marketing.css › [data-demo="scroll"]`; keep the two in step.
 */
export const DEMO_SCROLL_VH = 900;
/** The banner intro's own scrub range (280vh track − 100vh pin). */
export const INTRO_SCROLL_VH = 180;
