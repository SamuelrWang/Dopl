"use client";

import { useEffect, useRef } from "react";

/** Share of the visual on screen before its sequence plays. */
const PLAY_RATIO = 0.6;

/**
 * Drives one Multiplayer card visual's CSS sequence by writing `data-play` on
 * its root: `armed` (hidden start state) → `in` (keyframes run, then HOLD on the
 * final frame). Leaving the viewport entirely re-arms it, so scrolling back
 * replays it — the scrub parks cards below the clipped stage, which reads as
 * "out of view" here too.
 *
 * ⚠ Armed HERE, never in the markup: SSR, no JS and prefers-reduced-motion
 * never get the attribute, and the base rules in marketing.css ARE the final
 * state — so those all render the finished UI, static.
 * ⚠ The only JS is the observer callback; every frame of motion is CSS.
 */
export function useVisualPlay<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    el.dataset.play = "armed";
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.intersectionRatio >= PLAY_RATIO) el.dataset.play = "in";
        else if (!entry.isIntersecting) el.dataset.play = "armed";
      },
      { threshold: [0, PLAY_RATIO] },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      delete el.dataset.play;
    };
  }, []);

  return ref;
}
