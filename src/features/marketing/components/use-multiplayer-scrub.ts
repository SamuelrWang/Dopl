"use client";

import { useEffect, useRef, useState } from "react";
import { clamp01, ease, easeOut, ramp } from "../motion";

/**
 * Scroll-scrub engine for the Multiplayer benefits row. Markup:
 * multiplayer-section.tsx.
 *
 * Same shape as use-banner-scrub — tall wrapper + one-viewport `position:
 * sticky` stage, every value a pure function of `progress`, so scrubbing back
 * up plays it backwards. Beats: the text fades up, then each card is drawn from
 * below the stage floor into its slot, left to right.
 *
 * ⚠ p = 0 IS NOT THE PIN, it is `LEAD` viewports earlier, while the section is
 * still rising. Start the text at the pin instead and a viewport-tall EMPTY
 * stage scrolls past before anything appears.
 *
 * ⚠ Card travel is MEASURED every frame, never a constant: a card is parked at
 * the row's own distance to the viewport floor, which puts its top edge exactly
 * on the fold at any viewport height and whether or not the stage has pinned.
 */

/** p = 0 with the scene's top this far down the viewport, in viewport heights. */
const LEAD = 0.55;

/**
 * Beats, in progress units. Scene is 250vh (marketing.css), so the pin lands at
 * LEAD / (1.5 + LEAD) ≈ 0.27: the text is settled before it and all three cards
 * rise while the stage is held still. The tail past the last card is the hold
 * before the scene lets go.
 */
const TEXT_END = 0.15;
const CARD_START = 0.3;
const CARD_STEP = 0.21;
const CARD_SPAN = 0.2;

/** Text rise, px. */
const TEXT_RISE = 14;

/**
 * Below either, there is nothing a pin can hold: at 900px the cards stack one
 * per row and a single card is already taller than most viewports, and a short
 * screen cannot fit the row inside the stage at all. `reveal` takes over.
 */
const MIN_SCRUB_WIDTH = 900;
const MIN_SCRUB_HEIGHT = 760;

/**
 * `reveal` fires with the section's top this far down the viewport. ⚠ Half, not
 * the third it started at — at a third the fade finished while the eyebrow was
 * still near the fold, so by the time it was worth reading it had already
 * played and the text just looked permanently visible.
 */
const REVEAL_LINE = 0.5;

/**
 * `static`  — SSR / no-JS: the row, laid out, nothing hidden.
 * `reduced` — prefers-reduced-motion: the same, flat.
 * `reveal`  — too small to pin: one-shot fade + rise on scroll-in, CSS only.
 * `scrub`   — the pinned scene.
 */
export type MultiplayerMode = "static" | "reduced" | "reveal" | "scrub";

export function useMultiplayerScrub() {
  // SSR + no-JS land on `static`; only ever upgraded client-side after mount.
  const [mode, setMode] = useState<MultiplayerMode>("static");
  const sceneRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const small = window.matchMedia(
      `(max-width: ${MIN_SCRUB_WIDTH - 1}px), (max-height: ${MIN_SCRUB_HEIGHT - 1}px)`,
    );
    const pick = () =>
      setMode(reduced.matches ? "reduced" : small.matches ? "reveal" : "scrub");
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
    const cards = cardsRef.current;
    if (!scene || !cards) return;

    const items = Array.from(cards.children) as HTMLElement[];
    let frame = 0;

    const render = () => {
      frame = 0;
      const vh = window.innerHeight;
      const sceneRect = scene.getBoundingClientRect();
      const lead = vh * LEAD;
      const range = sceneRect.height - vh + lead;
      const p = range > 0 ? clamp01((lead - sceneRect.top) / range) : 0;

      const text = ease(ramp(p, 0, TEXT_END));
      scene.style.setProperty("--lp-mp-text-opacity", `${text}`);
      scene.style.setProperty("--lp-mp-text-y", `${(1 - text) * TEXT_RISE}px`);

      // The ROW's box, which nothing transforms — reading a card here would be
      // reading back the offset written on the previous frame.
      const park = Math.max(vh - cards.getBoundingClientRect().top, 0);

      items.forEach((item, i) => {
        const from = CARD_START + i * CARD_STEP;
        const y = (1 - easeOut(ramp(p, from, from + CARD_SPAN))) * park;
        item.style.transform = `translate3d(0, ${y}px, 0)`;
      });
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(render);
    };

    // ⚠ bfcache revival — same rationale as use-banner-scrub.ts › onPageShow:
    // a discarded-but-latched rAF id would swallow scroll events until reload.
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
      for (const item of items) item.style.transform = "";
      scene.style.removeProperty("--lp-mp-text-opacity");
      scene.style.removeProperty("--lp-mp-text-y");
    };
  }, [mode]);

  useEffect(() => {
    if (mode !== "reveal") return;
    const scene = sceneRef.current;
    if (!scene) return;

    // ⚠ Armed HERE, never in the markup — no JS (or no observer) leaves the row
    // at its static end state instead of blank.
    scene.dataset.reveal = "armed";

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        scene.dataset.reveal = "in";
        observer.disconnect();
      },
      // ⚠ A ratio `threshold` cannot do this: stacked, the section runs several
      // viewports tall, so 30% of it is never on screen at once and the
      // observer never fires. A bottom margin is viewport-relative instead.
      { rootMargin: `0px 0px -${REVEAL_LINE * 100}% 0px` },
    );
    observer.observe(scene);
    return () => {
      observer.disconnect();
      delete scene.dataset.reveal;
    };
  }, [mode]);

  return { mode, sceneRef, cardsRef };
}
