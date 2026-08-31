"use client";

import { useEffect, useRef, useState } from "react";
import { STEPS, stepIndex } from "./demo-steps";

/**
 * Clock for the banner demo. Advances one integer `step` through STEPS on
 * per-step timeouts, looping forever while `playing`. `run` increments on
 * every restart — the scene keys per-loop component state (the info column's
 * internal tab) on it so a fresh loop starts from the product's own defaults.
 *
 * Play/stop is slaved to the SLOT's visibility, not to scroll maths of its
 * own: use-banner-scrub writes `--lp-slot-opacity` (0 or 1) INLINE on the
 * scene element only when it flips, so a MutationObserver on that style
 * attribute is the wake signal. ⚠ Not transition events on the slot — a
 * hidden tab skips CSS transitions entirely (no events ever fire) while the
 * engine's var writes still happen, which deadlocks an event-based clock.
 * Fresh shows restart from step 0 — the demo should always be watched from
 * the top; `visibilitychange` stops the clock in hidden tabs so throttled
 * timers can't drag the scene mid-story while nobody watches.
 *
 * ⚠ prefers-reduced-motion: the scrub engine never runs (`reduced` mode shows
 * the slot at opacity 1 with no transition), so no engine write ever arrives.
 * The tableau branch below parks the timeline on `hold` — the full
 * collaborative scene — and never starts the clock.
 */
export function useDemoTimeline() {
  const [step, setStep] = useState(0);
  const [run, setRun] = useState(0);
  const [playing, setPlaying] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number>(0);

  // Advance while playing. One timeout per step; loop past the end.
  useEffect(() => {
    if (!playing) return;
    timer.current = window.setTimeout(() => {
      const wraps = step + 1 >= STEPS.length;
      if (wraps) setRun((r) => r + 1);
      setStep(wraps ? 0 : step + 1);
    }, STEPS[step].dur);
    return () => window.clearTimeout(timer.current);
  }, [playing, step]);

  // Slave play state to the slot's opacity flips.
  useEffect(() => {
    const root = rootRef.current;
    const slot = root?.parentElement; // .lp-banner-demo-slot
    if (!root || !slot) return;

    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    // Edge detector in a ref, not read back from state: sync() must be able
    // to run from any callback without a stale-closure play flag.
    let wasShown = false;
    const sync = () => {
      if (reduced) {
        // Park on the full tableau; the clock never runs.
        setStep(stepIndex("hold"));
        setPlaying(false);
        return;
      }
      // The custom property is the TARGET; computed opacity lags mid-fade.
      const shown =
        !document.hidden &&
        getComputedStyle(slot).getPropertyValue("--lp-slot-opacity").trim() ===
          "1";
      if (shown && !wasShown) {
        // Fresh show: always watched from the top, with per-loop UI state
        // (the info column's tab) reset via the run key.
        setStep(0);
        setRun((r) => r + 1);
      }
      wasShown = shown;
      setPlaying(shown);
    };

    // The engine writes the var inline on the scene, and only when it flips.
    const scene = slot.closest<HTMLElement>(".lp-banner-scene");
    const observer = new MutationObserver(sync);
    if (scene)
      observer.observe(scene, {
        attributes: true,
        attributeFilter: ["style"],
      });
    document.addEventListener("visibilitychange", sync);

    // Initial state via timeout, not the effect body (lint) and not rAF
    // (never fires in a hidden tab) — the page may load mid-scroll with the
    // slot already shown, or in `reduced` mode where the engine never writes.
    const t = window.setTimeout(sync, 0);
    return () => {
      window.clearTimeout(t);
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  return { step, run, rootRef };
}
