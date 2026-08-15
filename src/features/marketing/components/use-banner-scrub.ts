"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Scroll-scrub engine for the pinned banner scene (see hero-banner.tsx for the
 * markup it drives, notification-card.tsx for the card's content).
 *
 * The scene is a tall wrapper holding a `position: sticky` stage one viewport
 * tall that centres the picture inside itself. You scroll normally until the
 * wrapper's top reaches the viewport top — at that instant the picture is
 * already whole and vertically centred, so the pin is seamless — and every
 * further pixel of the wrapper's range drives `progress` 0→1. The choreography
 * across that range is a notification being clicked, and then becoming the app:
 *
 *   CURSOR_*          a macOS arrow flies in from offscreen top-right along a
 *                     cubic bezier and lands on the notification card
 *   PRESS_/CLICK_AT   the click: ripple on the glass (one-shot), the cursor
 *                     dips — no card tilt (see the rendering note below)
 *   EXPAND_*          the glass grows from its top-right notification seat to a
 *                     rectangle inset ~4.5% inside the picture. The top-right
 *                     corner barely moves, so the growth radiates from it
 *   NOTIF_FADE_*      the notification content fades out early in that growth,
 *                     before the box stretches far enough to look wrong
 *   CURSOR_FADE_*     the arrow fades out over the same stretch
 *   SLOT_FADE_*       a white rounded panel fades in on top of the glass
 *
 * Past 1 the wrapper's range is spent, sticky releases, the page continues.
 *
 * ── Glass rendering: exact box per frame, staticMap, NO TILT ───────────────
 * The glass wrapper is positioned by translate3d and sized per frame; the
 * displacement map is frozen (LiquidGlass `staticMap`) so nothing pops. The
 * click TILT was removed (2026-08-13): rotating the backdrop-filter container
 * was the prime suspect for Chrome dropping the blur mid-scene. The click is
 * carried by the ripple + the cursor's press dip alone.
 *
 * ── Why the ripple is a one-shot and everything else is scrubbed ───────────
 * Position-driven values (box, cursor point, tilt, dip, opacities) are pure
 * functions of `progress`, so scrubbing backward simply plays them in reverse
 * and there is no state to get wrong. A ripple is not that: it is an impact
 * with its OWN duration. Scrubbing it would tie the expansion of the circle to
 * scroll speed — it would stall mid-flight whenever the wheel stopped, which
 * reads as a bug rather than a click. So the ripple is a CSS animation fired
 * once when progress crosses CLICK_AT going forward, and re-armed only after
 * progress falls back below CLICK_AT - CLICK_REARM. That hysteresis band is
 * what keeps a reversing scroll sane: jitter around the threshold cannot
 * machine-gun the animation, and scrolling properly back up before the click
 * re-arms it so the next pass down replays it exactly once.
 */

/** Scrub breakpoints, in progress units (0→1 across the pinned range). */
export const CURSOR_START = 0.05;
export const CURSOR_END = 0.28;
/** The press: dip starts, peaks at the click, cursor is back up by DIP_END. */
export const PRESS_START = 0.28;
export const CLICK_AT = 0.3;
export const DIP_END = 0.325;
/** Progress must fall this far below CLICK_AT before the ripple re-arms. */
export const CLICK_REARM = 0.02;
export const EXPAND_START = 0.36;
export const EXPAND_END = 0.75;
export const NOTIF_FADE_START = 0.36;
export const NOTIF_FADE_END = 0.5;
export const CURSOR_FADE_START = 0.36;
export const CURSOR_FADE_END = 0.5;
export const SLOT_FADE_START = 0.8;
export const SLOT_FADE_END = 0.95;

/**
 * Glass geometry. Start = the notification seat, top-right of the picture;
 * end = inset in the picture. `NOTIF_H` must stay in step with the fixed height
 * of `.lp-banner-notif` in marketing.css — the content keeps its own height as
 * the box grows past it, so it fades out in place instead of re-centring.
 */
const NOTIF_TOP = 0.05; // fraction of picture height
const NOTIF_RIGHT = 0.035; // fraction of picture width
const NOTIF_MAX_W = 380; // px — a notification, wider than tall
const NOTIF_W_FRAC = 0.42; // cap on narrow pictures
const NOTIF_H = 92; // px
const END_INSET = 0.045; // fraction of the picture box, all four sides

/** Below this the picture is too small to seat the card — scrub is off. */
const MIN_SCRUB_WIDTH = 900;

/**
 * `static`  — SSR / no-JS / too narrow: picture + the notification seated
 *             top-right, no cursor, nothing pinned.
 * `reduced` — prefers-reduced-motion: the END state, flat, no cursor.
 * `scrub`   — the pinned scene.
 */
export type BannerMode = "static" | "reduced" | "scrub";

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** smoothstep — eases in and out, so the growth never starts or stops abruptly. */
const ease = (t: number) => t * t * (3 - 2 * t);
/** easeOutQuad — the cursor decelerates onto the card instead of slamming in.
 *  Quad, not cubic: cubic spent the back half of the travel range creeping
 *  through the last few percent of the path. */
const easeOut = (t: number) => 1 - (1 - t) ** 2;
const ramp = (p: number, from: number, to: number) => clamp01((p - from) / (to - from));

type Box = { x: number; y: number; w: number; h: number };
type Point = { x: number; y: number };

/** The notification seat inside a picture of W×H — also the glass's start box. */
function notifBox(W: number, H: number): Box {
  const w = Math.min(NOTIF_MAX_W, W * NOTIF_W_FRAC);
  return { x: W * (1 - NOTIF_RIGHT) - w, y: H * NOTIF_TOP, w, h: NOTIF_H };
}

/**
 * The glass box inside a picture of W×H, at eased expansion `t`. Start and end
 * share a near-identical top and right edge (5% vs 4.5%, 3.5% vs 4.5%), so the
 * panel visibly grows DOWN and LEFT out of its top-right corner.
 */
function glassBox(W: number, H: number, t: number): Box {
  const s = notifBox(W, H);
  return {
    x: lerp(s.x, W * END_INSET, t),
    y: lerp(s.y, H * END_INSET, t),
    w: lerp(s.w, W * (1 - 2 * END_INSET), t),
    h: lerp(s.h, H * (1 - 2 * END_INSET), t),
  };
}

/** Where the click lands: on the card, at its two-thirds point. */
function clickPoint(W: number, H: number): Point {
  const n = notifBox(W, H);
  return { x: n.x + n.w * 0.67, y: n.y + n.h * 0.5 };
}

/**
 * The cursor's tip at eased travel `t`, as a cubic bezier in picture
 * coordinates. P0 is offscreen above the top-right corner; the two controls
 * sweep the arrow left and down INTO the picture before it curls back up-right
 * onto the card — a hand reaching for something, not a straight line to it.
 */
function cursorPoint(W: number, H: number, t: number): Point {
  const p3 = clickPoint(W, H);
  const p0 = { x: W * 1.06, y: -H * 0.3 };
  const p1 = { x: W * 0.62, y: H * 0.16 };
  const p2 = { x: W * 0.66, y: H * 0.62 };
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

/** 0 → 1 → 0 across the press. Drives the cursor's dip, without the overshoot. */
function clickDip(p: number): number {
  if (p <= PRESS_START || p >= DIP_END) return 0;
  return p < CLICK_AT
    ? ease(ramp(p, PRESS_START, CLICK_AT))
    : 1 - ease(ramp(p, CLICK_AT, DIP_END));
}

export function useBannerScrub() {
  // SSR and no-JS land on `static`: the picture with the notification in its
  // seat. The mode is only ever upgraded on the client, after mount.
  const [mode, setMode] = useState<BannerMode>("static");
  const sceneRef = useRef<HTMLDivElement>(null);
  const pictureRef = useRef<HTMLDivElement>(null);
  const glassRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const rippleRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const narrow = window.matchMedia(`(max-width: ${MIN_SCRUB_WIDTH - 1}px)`);
    const pick = () =>
      setMode(reduced.matches ? "reduced" : narrow.matches ? "static" : "scrub");
    pick();
    reduced.addEventListener("change", pick);
    narrow.addEventListener("change", pick);
    return () => {
      reduced.removeEventListener("change", pick);
      narrow.removeEventListener("change", pick);
    };
  }, []);

  useEffect(() => {
    if (mode !== "scrub") return;
    const scene = sceneRef.current;
    const picture = pictureRef.current;
    const glass = glassRef.current;
    const cursor = cursorRef.current;
    const ripple = rippleRef.current;
    if (!scene || !picture || !glass || !cursor) return;

    let frame = 0;
    // The ripple is the one beat that is NOT a function of progress — see the
    // header. `armed` is the whole of its state.
    let armed = true;

    // EXACT box every frame — no buckets, no residual scale. The glass card
    // runs with `staticMap` (see LiquidGlass): its displacement map is built
    // once and stretches with the box, so a layout resize costs a small
    // reflow and NO map rebuild. The old bucket scheme existed to ration
    // rebuilds, and each rebuild swapped the <feImage> data-URI — the async
    // decode of that swap was visible as a pop at every bucket boundary.
    const render = () => {
      frame = 0;
      const sceneRect = scene.getBoundingClientRect();
      const pictureRect = picture.getBoundingClientRect();
      const range = sceneRect.height - window.innerHeight;
      const p = range > 0 ? clamp01(-sceneRect.top / range) : 0;

      const W = pictureRect.width;
      const H = pictureRect.height;

      const t = ease(ramp(p, EXPAND_START, EXPAND_END));
      const box = glassBox(W, H, t);

      glass.style.width = `${box.w}px`;
      glass.style.height = `${box.h}px`;
      glass.style.transform = `translate3d(${box.x}px, ${box.y}px, 0)`;

      // Cursor: bezier point + an approach scale-down, then the press dip.
      const travel = easeOut(ramp(p, CURSOR_START, CURSOR_END));
      const tip = cursorPoint(W, H, travel);
      const scale = lerp(1.2, 1, travel) * (1 - 0.1 * clickDip(p));
      cursor.style.transform = `translate3d(${tip.x}px, ${tip.y}px, 0) scale(${scale})`;

      scene.style.setProperty(
        "--lp-cursor-opacity",
        `${ramp(p, 0, CURSOR_START) * (1 - ramp(p, CURSOR_FADE_START, CURSOR_FADE_END))}`,
      );
      scene.style.setProperty(
        "--lp-notif-opacity",
        `${1 - ramp(p, NOTIF_FADE_START, NOTIF_FADE_END)}`,
      );
      scene.style.setProperty("--lp-slot-opacity", `${ramp(p, SLOT_FADE_START, SLOT_FADE_END)}`);

      if (ripple) {
        if (armed && p >= CLICK_AT) {
          armed = false;
          const hit = clickPoint(W, H);
          // Glass-local, because the ripple lives inside the glass card.
          ripple.style.left = `${hit.x - box.x}px`;
          ripple.style.top = `${hit.y - box.y}px`;
          // Restart the CSS animation: drop the class, force a reflow so the
          // removal is committed, re-add it.
          ripple.classList.remove("is-firing");
          void ripple.offsetWidth;
          ripple.classList.add("is-firing");
        } else if (!armed && p < CLICK_AT - CLICK_REARM) {
          armed = true;
          ripple.classList.remove("is-firing");
        }
      }
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(render);
    };

    render();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      // Hand the boxes back to the stylesheet if the mode flips out of scrub.
      glass.style.cssText = "";
      cursor.style.cssText = "";
      ripple?.classList.remove("is-firing");
      scene.style.removeProperty("--lp-cursor-opacity");
      scene.style.removeProperty("--lp-notif-opacity");
      scene.style.removeProperty("--lp-slot-opacity");
    };
  }, [mode]);

  return { mode, sceneRef, pictureRef, glassRef, cursorRef, rippleRef };
}
