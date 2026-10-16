"use client";

import { useEffect, useRef, useState } from "react";
import { STEPS, stepIndex } from "./demo-steps";

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
  }, []);

  return { step, run, rootRef };
}
