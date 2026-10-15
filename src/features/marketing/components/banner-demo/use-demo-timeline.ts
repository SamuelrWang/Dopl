"use client";

import { useEffect, useRef, useState } from "react";
import { STEPS, stepIndex } from "./demo-steps";
import type { DemoDrive } from "./demo-drive";

/**
 * Scroll drive: progress 0→1 maps onto the beats weighted by their `dur`, so a
 * long read gets a long stretch of scroll. `reset-fade` is excluded — there is
 * no loop; the end of the track parks on `hold`.
 */
const SCROLL_STEPS = STEPS.slice(0, stepIndex("hold") + 1);
const SCROLL_TOTAL = SCROLL_STEPS.reduce((t, s) => t + s.dur, 0);
function stepAtProgress(q: number): number {
  let acc = 0;
  for (let i = 0; i < SCROLL_STEPS.length; i++) {
    acc += SCROLL_STEPS[i].dur;
    if (q * SCROLL_TOTAL < acc) return i;
  }
  return SCROLL_STEPS.length - 1;
}
/** ms per beat while the shown step catches up with the scroll target. Every
 *  beat is visited (never skipped) so the scripted clicks still fire. */
const CHASE_MS = 70;

/**
 * Clock for the banner demo. Advances one integer `step` through STEPS on
 * per-step timeouts, looping while `playing`. `run` increments on every restart,
 * and the scene keys per-loop component state on it so a fresh loop starts from
 * the product's own defaults.
 *
 * Play/stop is slaved to the slot's visibility: `use-banner-scrub` writes
 * `--lp-slot-opacity` inline on the scene element only when it flips, so a
 * MutationObserver on that style attribute is the wake signal. Not transition
 * events — a hidden tab skips CSS transitions entirely while the engine's var
 * writes still happen, which deadlocks an event-based clock. `visibilitychange`
 * stops the clock in hidden tabs so throttled timers cannot drag the scene.
 *
 * Under prefers-reduced-motion the scrub engine never runs, so no write arrives;
 * the tableau branch parks the timeline on `hold` and never starts the clock.
 */
export function useDemoTimeline(drive: DemoDrive = "time") {
  const [step, setStep] = useState(0);
  const [run, setRun] = useState(0);
  const [playing, setPlaying] = useState(false);
  /** Scroll drive only: the step the scroll position asks for. */
  const [target, setTarget] = useState(0);
  /** Scroll drive only: +1 forward, -1 reversing. Clicks fire forward only. */
  const [dir, setDir] = useState<1 | -1>(1);
  const rootRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number>(0);

  // Scroll drive: walk one beat at a time toward the target, either way.
  useEffect(() => {
    if (drive !== "scroll" || step === target) return;
    timer.current = window.setTimeout(() => {
      const next = step + (target > step ? 1 : -1);
      setDir(target > step ? 1 : -1);
      // Reversing below the Agents-tab click: the info column's tab is its own
      // internal state, so remount it (and the pane) back to their defaults.
      if (next < stepIndex("click-tab") && step >= stepIndex("click-tab"))
        setRun((r) => r + 1);
      setStep(next);
    }, CHASE_MS);
    return () => window.clearTimeout(timer.current);
  }, [drive, step, target]);

  // Advance while playing. One timeout per step; loop past the end.
  useEffect(() => {
    if (drive === "scroll" || !playing) return;
    timer.current = window.setTimeout(() => {
      const wraps = step + 1 >= STEPS.length;
      if (wraps) setRun((r) => r + 1);
      setStep(wraps ? 0 : step + 1);
    }, STEPS[step].dur);
    return () => window.clearTimeout(timer.current);
  }, [drive, playing, step]);

  // Slave play state to the slot's opacity flips.
  useEffect(() => {
    const root = rootRef.current;
    const slot = root?.parentElement; // .lp-banner-demo-slot
    if (!root || !slot) return;

    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    // Edge detector in a ref, not read back from state: sync() must run from any
    // callback without a stale-closure play flag.
    let wasShown = false;
    const sync = () => {
      if (reduced) {
        // Park on the full tableau; the clock never runs.
        setStep(stepIndex("hold"));
        setPlaying(false);
        return;
      }
      if (drive === "scroll") {
        // Scroll position is the clock: no play state, no loop, no reset.
        const q = parseFloat(
          getComputedStyle(slot).getPropertyValue("--lp-demo-progress"),
        );
        setTarget(stepAtProgress(Number.isFinite(q) ? q : 0));
        return;
      }
      // The custom property is the TARGET; computed opacity lags mid-fade.
      const shown =
        !document.hidden &&
        getComputedStyle(slot).getPropertyValue("--lp-slot-opacity").trim() ===
          "1";
      if (shown && !wasShown) {
        // Fresh show: watched from the top, with per-loop UI state reset via the
        // run key.
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

    // Initial state via timeout, not the effect body (lint) and not rAF (never
    // fires in a hidden tab) — the page may load mid-scroll with the slot already
    // shown, or in `reduced` mode where the engine never writes.
    const t = window.setTimeout(sync, 0);
    return () => {
      window.clearTimeout(t);
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [drive]);

  return { step, run, dir, rootRef };
}
