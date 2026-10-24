"use client";

import { useEffect, useRef, useState } from "react";
import { clamp01, ease, ramp } from "../motion";

/**
 * Scroll-scrub engine for the Devices band. Markup: devices-section.tsx.
 *
 * Same shape as use-multiplayer-scrub: the band is the tall scroll TRACK, its
 * one-viewport `position: sticky` stage pins with the content centred, and
 * every value is a pure function of `progress`, so scrolling back up plays it
 * backwards. p = 0 is the PIN (band top at the viewport top) — before it the
 * first card simply rides in with the band.
 *
 * The deck: card `active` sits in front; the rest fan out to the RIGHT behind
 * it, each step further back tilted, shifted and shrunk a little more. A swap
 * pulls the front card out to the left, drops it behind at the halfway point
 * and tucks it in at the back, while every other card moves one step forward.
 * The copy cross-fades on the same clock (out by the halfway point, in after).
 */

/**
 * Swap windows, in progress units, one per gap between cards. Track is 340vh
 * (devices.css), so 2.4 viewports of scroll drive it; the gaps between windows
 * are the holds where a card is read, and the tail past the last window is the
 * hold before the band lets go.
 */
const SWAPS: readonly (readonly [number, number])[] = [
  [0.1, 0.4],
  [0.52, 0.82],
];

/** Per step back in the deck. */
const STEP_X = 7; // % of card width, to the right
const STEP_ROT = 4; // deg, clockwise
const STEP_SCALE = 0.06;
const STEP_SHADE = 0.28;
/** How far the leaving card is pulled out to the left at the halfway point, % of card width. */
const PULL_X = 34;
const PULL_ROT = -4;
/** Copy drift while it fades, px. */
const COPY_DRIFT = 12;

/** Below either there is no room to pin a card beside its copy. `static` takes over. */
const MIN_SCRUB_WIDTH = 900;
const MIN_SCRUB_HEIGHT = 640;

/**
 * `static`  — SSR / no-JS / small screens: one row per device, nothing hidden.
 * `reduced` — prefers-reduced-motion: the same, flat.
 * `scrub`   — the pinned deck.
 */
export type DevicesMode = "static" | "reduced" | "scrub";

/** The deck pose for a card `depth` steps behind the front (fractional while moving). */
function pose(depth: number, pull: number) {
  const x = depth * STEP_X - pull * PULL_X;
  const rot = depth * STEP_ROT + pull * PULL_ROT;
  const scale = 1 - depth * STEP_SCALE;
  return `translate3d(${x}%, 0, 0) rotate(${rot}deg) scale(${scale})`;
}

export function useDevicesScrub(count: number) {
  const [mode, setMode] = useState<DevicesMode>("static");
  const sceneRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const small = window.matchMedia(
      `(max-width: ${MIN_SCRUB_WIDTH - 1}px), (max-height: ${MIN_SCRUB_HEIGHT - 1}px)`,
    );
    const pick = () => setMode(reduced.matches ? "reduced" : small.matches ? "static" : "scrub");
    pick();
    reduced.addEventListener("change", pick);
    small.addEventListener("change", pick);
    return () => {
      reduced.removeEventListener("change", pick);
      small.removeEventListener("change", pick);
    };
  }, []);

  useEffect(() => {
    if (mode !== "scrub") return;
    const scene = sceneRef.current;
    const list = listRef.current;
    if (!scene || !list) return;

    const copies = Array.from(list.querySelectorAll<HTMLElement>(".lp-dev-copy"));
    const cards = Array.from(list.querySelectorAll<HTMLElement>(".lp-dev-media"));
    const n = Math.min(count, cards.length, copies.length);
    if (n === 0) return;
    let frame = 0;

    const render = () => {
      frame = 0;
      const vh = window.innerHeight;
      const rect = scene.getBoundingClientRect();
      const range = rect.height - vh;
      const p = range > 0 ? clamp01(-rect.top / range) : 0;

      // Continuous front index, 0 … n-1.
      let active = 0;
      for (let k = 0; k < Math.min(SWAPS.length, n - 1); k++) {
        active += ease(ramp(p, SWAPS[k][0], SWAPS[k][1]));
      }
      const step = Math.min(Math.floor(active), Math.max(n - 2, 0));
      const s = active - step;

      for (let i = 0; i < n; i++) {
        const before = (((i - step) % n) + n) % n;
        let depth: number;
        let pull = 0;
        let z: number;
        if (before === 0 && n > 1) {
          // Leaving the front: out to the left, behind at the halfway point, in at the back.
          depth = s * (n - 1);
          pull = Math.sin(Math.PI * s);
          z = s < 0.5 ? n + 1 : 0;
        } else {
          depth = before - s;
          z = n - Math.round(depth);
        }
        const card = cards[i];
        card.style.transform = pose(depth, pull);
        card.style.zIndex = `${z}`;
        card.style.setProperty("--lp-dev-shade", `${Math.min(depth * STEP_SHADE, 0.8)}`);
        // Live overlays (use-feed-player) only play on the front card. Written
        // only on change: every write wakes their MutationObserver.
        const isFront = depth < 0.5 && pull < 0.5 ? "true" : "false";
        if (card.dataset.front !== isFront) card.dataset.front = isFront;

        // Copy: fully in at its own index, gone half a swap away.
        const off = active - i;
        const shown = clamp01(1 - Math.abs(off) * 2.2);
        const copy = copies[i];
        copy.style.opacity = `${shown}`;
        copy.style.transform = `translate3d(0, ${-off * COPY_DRIFT}px, 0)`;
        copy.style.visibility = shown > 0 ? "visible" : "hidden";
        copy.setAttribute("aria-hidden", shown > 0.5 ? "false" : "true");
      }
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(render);
    };

    // ⚠ bfcache revival — same rationale as use-banner-scrub.ts › onPageShow.
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      frame = 0;
      render();
    };

    render();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    window.addEventListener("pageshow", onPageShow);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("pageshow", onPageShow);
      // Hand the boxes back to the stylesheet when mode flips out of scrub.
      for (const card of cards) {
        card.style.transform = "";
        card.style.zIndex = "";
        card.style.removeProperty("--lp-dev-shade");
        delete card.dataset.front;
      }
      for (const copy of copies) {
        copy.style.opacity = "";
        copy.style.transform = "";
        copy.style.visibility = "";
        copy.removeAttribute("aria-hidden");
      }
    };
  }, [mode, count]);

  return { mode, sceneRef, listRef };
}
