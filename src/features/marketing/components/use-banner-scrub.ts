"use client";

import { useEffect, useRef, useState } from "react";
import { createBannerHum } from "../banner-hum";
import { clamp01, ease, easeOut, lerp, ramp } from "../motion";

/**
 * Scroll-scrub engine for the pinned banner scene. Markup: hero-banner.tsx;
 * card content: notification-card.tsx.
 *
 * Tall wrapper + one-viewport `position: sticky` stage. Wrapper range past the
 * pin drives `progress` 0→1; the CURSOR_/PRESS_/EXPAND_/…_FADE_ constants below
 * are the beats across it (cursor flies in, clicks, glass grows out of its
 * top-right notification seat, contents cross-fade).
 *
 * ⚠ NO card tilt. Rotating the backdrop-filter container was the prime suspect
 * for Chrome dropping the blur mid-scene (removed 2026-08-13). The click reads
 * from the ripple + the cursor's press dip alone.
 *
 * ⚠ Ripple is a one-shot, not scrubbed. Everything else is a pure function of
 * `progress`, so reversing just plays it backward. A ripple has its OWN
 * duration — scrubbing ties circle growth to scroll speed and it stalls
 * whenever the wheel stops. So: CSS animation fired once crossing CLICK_AT
 * forward, re-armed only below CLICK_AT - CLICK_REARM. That hysteresis band
 * stops threshold jitter machine-gunning the animation.
 */

/** Scrub breakpoints, in progress units (0→1 across the pinned range). */
const CURSOR_START = 0.05;
const CURSOR_END = 0.28;
/** Press: dip starts, peaks at the click, cursor back up by DIP_END. */
const PRESS_START = 0.28;
const CLICK_AT = 0.3;
const DIP_END = 0.325;
/** Progress must fall this far below CLICK_AT before the ripple re-arms. */
const CLICK_REARM = 0.02;
const EXPAND_START = 0.36;
const EXPAND_END = 0.75;
const NOTIF_FADE_START = 0.36;
const NOTIF_FADE_END = 0.5;
const CURSOR_FADE_START = 0.36;
const CURSOR_FADE_END = 0.5;
/** ⚠ The white demo slot is a threshold FLIP with hysteresis, never a scrubbed
 *  ramp — scrubbed, a scroll stopping mid-band parks it half-transparent. The
 *  engine writes only 0 or 1 into `--lp-slot-opacity`; the fixed-duration fade
 *  is the CSS `transition` on `.lp-banner-demo-slot`. Shows crossing SHOW_AT
 *  forward, hides falling below HIDE_AT — the gap keeps scroll jitter at the
 *  boundary from strobing it. */
const SLOT_SHOW_AT = 0.85;
const SLOT_HIDE_AT = 0.8;

/**
 * Glass geometry. Start = notification seat (top-right of picture); end = inset.
 * ⚠ `NOTIF_H` must stay in sync with `.lp-banner-notif`'s fixed height in
 * marketing.css — content keeps its own height as the box grows past it, so it
 * fades out in place instead of re-centring.
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
 * `static`  — SSR / no-JS / too narrow: picture + seated notification, no
 *             cursor, nothing pinned.
 * `reduced` — prefers-reduced-motion: END state, flat, no cursor.
 * `scrub`   — the pinned scene.
 */
export type BannerMode = "static" | "reduced" | "scrub";

type Box = { x: number; y: number; w: number; h: number };
type Point = { x: number; y: number };

/** Notification seat inside a picture of W×H — also the glass's start box. */
function notifBox(W: number, H: number): Box {
  const w = Math.min(NOTIF_MAX_W, W * NOTIF_W_FRAC);
  return { x: W * (1 - NOTIF_RIGHT) - w, y: H * NOTIF_TOP, w, h: NOTIF_H };
}

/**
 * Glass box inside a picture of W×H at eased expansion `t`. Start/end share a
 * near-identical top + right edge (5% vs 4.5%, 3.5% vs 4.5%) so the panel grows
 * DOWN and LEFT out of its top-right corner.
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

/** Click lands on the card at its two-thirds point. */
function clickPoint(W: number, H: number): Point {
  const n = notifBox(W, H);
  return { x: n.x + n.w * 0.67, y: n.y + n.h * 0.5 };
}

/**
 * Cursor tip at eased travel `t` — cubic bezier in picture coords. P0 offscreen
 * above the top-right corner; controls sweep left+down INTO the picture before
 * curling back up-right onto the card (a reach, not a straight line).
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
  // SSR + no-JS land on `static`; only ever upgraded client-side after mount.
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
    // Ripple's whole state — the one beat not a function of progress.
    let armed = true;
    // The slot flip's whole state; `slotFirst` forces the initial write so a
    // scene entered mid-scroll lands on the right side without a crossing.
    let slotShown = false;
    let slotFirst = true;
    // Low generator hum under the expansion. One voice per live scene, released
    // with it; idle until the expansion actually moves. Position sets presence,
    // scroll speed sets swell — see ../banner-hum.
    const hum = createBannerHum();

    // ⚠ EXACT box every frame, no buckets, no residual scale. LiquidGlass
    // `staticMap` builds the displacement map once and stretches it with the
    // box, so resize costs a reflow and NO map rebuild. Rationing rebuilds by
    // bucket swaps the <feImage> data-URI, and its async decode pops visibly.
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

      // The EASED value deliberately: the hum should track the growth the eye
      // sees, which slows at both ends, not the raw scroll behind it.
      hum.update(t);

      glass.style.width = `${box.w}px`;
      glass.style.height = `${box.h}px`;
      glass.style.transform = `translate3d(${box.x}px, ${box.y}px, 0)`;

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
      // 0 or 1 only — the CSS transition is the fade. See SLOT_SHOW_AT.
      const slotNext = slotShown ? p > SLOT_HIDE_AT : p >= SLOT_SHOW_AT;
      if (slotNext !== slotShown || slotFirst) {
        slotShown = slotNext;
        scene.style.setProperty("--lp-slot-opacity", slotShown ? "1" : "0");
      }
      slotFirst = false;

      if (ripple) {
        if (armed && p >= CLICK_AT) {
          armed = false;
          const hit = clickPoint(W, H);
          // Glass-local coords: ripple lives inside the glass card.
          ripple.style.left = `${hit.x - box.x}px`;
          ripple.style.top = `${hit.y - box.y}px`;
          // ⚠ Restart the CSS animation: drop class, force reflow to commit
          // the removal, re-add. Without the reflow read it never replays.
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

    /** ⚠ Back/forward-cache revival. Navigating away froze this document with
     *  `frame` possibly holding a scheduled rAF id; some engines discard that
     *  callback instead of resuming it, and then the `if (!frame)` latch in
     *  `schedule` swallows every scroll event forever — the whole scene is
     *  dead until a manual reload. On a persisted pageshow the id is worthless:
     *  drop the latch and paint the restored scroll position immediately. (If
     *  the engine DID keep the callback it just runs `render` twice — both
     *  reset `frame`, so the double fire is harmless.) */
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
      // Owns oscillators and a rAF of its own; neither is reachable once this
      // effect is gone, so it has to be told.
      hum.dispose();
      // Hand the boxes back to the stylesheet when mode flips out of scrub.
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
