"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * The beat clock behind the Devices band's live card overlays (glasses-hud.tsx,
 * robot-chat.tsx). Plays a list of beats in order, loops, and slides the feed.
 *
 * - `count` = beats applied so far. Each beat may reveal `ticks(beat)` units
 *   one at a time (`words`), `cadence(beat)` ms apart — words of a typed line,
 *   or a single tick for a tool call finishing / a decision being answered —
 *   then holds `beat.hold` ms. After the last beat the feed fades
 *   (`fading`, `fadeMs`) and restarts at beat 1.
 * - Runs only while the card is on screen AND is the front card of the
 *   pinned stack (`data-front` on `.lp-dev-media`, written by
 *   use-devices-scrub; absent = list layout = always front).
 * - SSR / no JS / prefers-reduced-motion: every beat applied, every tick
 *   revealed, nothing moves.
 * - Slide = FLIP on `feedRef`: the feed is bottom-aligned, so a new beat
 *   pushes the lines above it up by its height; the layout effect measures
 *   that change, starts the feed translated back down by it and lets the CSS
 *   transition carry it up to rest.
 */
export function useFeedPlayer<B extends { readonly hold: number }>(opts: {
  readonly beats: readonly B[];
  readonly ticks: (beat: B) => number;
  readonly cadence: (beat: B) => number;
  readonly fadeMs: number;
}) {
  const { beats, ticks, cadence, fadeMs } = opts;
  const rootRef = useRef<HTMLDivElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const lastHeight = useRef(0);
  const [live, setLive] = useState(false);
  const [visible, setVisible] = useState(false);
  const [front, setFront] = useState(true);
  const [count, setCount] = useState(beats.length);
  const [words, setWords] = useState(Number.POSITIVE_INFINITY);
  const [fading, setFading] = useState(false);

  // Upgrade to the live loop after mount unless motion is reduced.
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const pick = () => {
      setLive(!reduced.matches);
      setCount(reduced.matches ? beats.length : 1);
      setWords(reduced.matches ? Number.POSITIVE_INFINITY : 0);
      setFading(false);
    };
    pick();
    reduced.addEventListener("change", pick);
    return () => reduced.removeEventListener("change", pick);
  }, [beats.length]);

  // Pause off screen, and while another card is in front of this one.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || !live) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    observer.observe(el);
    const card = el.closest<HTMLElement>(".lp-dev-media");
    const readFront = () => setFront(card?.dataset.front !== "false");
    readFront();
    const watch = new MutationObserver(readFront);
    if (card) watch.observe(card, { attributes: true, attributeFilter: ["data-front"] });
    return () => {
      observer.disconnect();
      watch.disconnect();
    };
  }, [live]);

  const beat = beats[count - 1];
  const total = beat ? ticks(beat) : 0;
  const wait = beat ? cadence(beat) : 0;

  // One timer per tick: next tick; or (beat finished) hold, then the next
  // beat; after the last, fade out and restart from the first.
  useEffect(() => {
    if (!live || !visible || !front || !beat) return;
    if (fading) {
      const id = window.setTimeout(() => {
        setCount(1);
        setWords(0);
        setFading(false);
      }, fadeMs);
      return () => window.clearTimeout(id);
    }
    const ticking = words < total;
    const id = window.setTimeout(
      () => {
        if (ticking) setWords((w) => w + 1);
        else if (count < beats.length) {
          setCount((c) => c + 1);
          setWords(0);
        } else setFading(true);
      },
      ticking ? wait : beat.hold,
    );
    return () => window.clearTimeout(id);
  }, [live, visible, front, fading, words, total, count, beat, wait, beats.length, fadeMs]);

  // FLIP the slide-up whenever the feed's height changes between beats.
  useLayoutEffect(() => {
    const el = feedRef.current;
    if (!el) return;
    const height = el.offsetHeight;
    const delta = height - lastHeight.current;
    lastHeight.current = height;
    if (!live || delta === 0 || count === 1) return;
    el.style.transition = "none";
    el.style.transform = `translate3d(0, ${delta}px, 0)`;
    void el.offsetHeight; // commit the start position before releasing it
    el.style.transition = "";
    el.style.transform = "";
  }, [count, words, live]);

  return { rootRef, feedRef, count, words, fading, beat };
}
