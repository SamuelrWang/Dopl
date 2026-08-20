"use client";

import { useEffect, useRef, useState } from "react";
import { createBannerHum } from "../banner-hum";
import { ease, lerp, ramp } from "../motion";

/**
 * Scroll-scrubbed grow/shrink for a glass panel seated in a full-width banner.
 * Two seats: the Ontology banner (components/ontology-section.tsx) and the
 * Connect band (components/connect-section.tsx) — box styling in
 * marketing.css under "Framework" and "Developers". The host sets `data-glass`
 * = the returned mode on the banner element; this hook drives the glass
 * wrapper's box and writes `--lp-glass-panel-opacity` on the banner for
 * whatever the host's CSS decides should fade with the panel.
 *
 * The panel enters as a small glass SQUARE and stays one while the banner is
 * still low in the viewport. As the banner rises toward centre the glass grows
 * to its full rectangle, and only once FULLY grown does the white window fade
 * in — the two phases never overlap. Scrolling on PAST does not close it: once
 * open it stays open (the offset clamps at zero — see `render`), matching the
 * hero banner. Only scrolling back UP plays it in reverse: window fades out
 * completely, then the glass collapses back to the square.
 *
 * ⚠ POSITION-DRIVEN, NOT A ONE-SHOT. This is the difference from
 * `scroll-reveal.tsx`, which arms once and never looks again. Everything here
 * is a pure function of where the banner sits in the viewport, which is what
 * "shrink back when they scroll away, in either direction" actually requires:
 * there is no played/not-played state to get wrong, no re-arming, and reversing
 * mid-way simply walks the same curve backwards.
 *
 * ⚠ TAB-INDEPENDENT by construction. The window's height is PINNED in CSS
 * (`--lp-ont-window-h`) precisely so the four vignettes cannot resize the panel,
 * which means the full box is the same on every tab and this hook never has to
 * know which one is selected. If that pin is ever removed, this breaks with it.
 *
 * ⚠ The glass runs `staticMap` while this is active, for the reason
 * hero-banner.tsx records: the box changes every frame, and a per-resize
 * displacement-map rebuild swaps an <feImage> data-URI whose async decode pops
 * the refraction. The frozen map stretches with the box instead.
 */

/** Side of the collapsed square, in px. */
const SQUARE_PX = 132;

/**
 * Everything is driven by ONE number: `offset`, the distance in px between the
 * banner's centre and the viewport's centre. Zero is perfectly centred; it grows
 * as the banner travels away in EITHER direction.
 *
 * ⚠ This replaced a pair of edge-reading ramps (banner top coming up, banner
 * bottom going out, combined with `min`). That pair had a latent geometry bug:
 * reaching full size required the top to be above one line while the bottom was
 * still below another, which is only satisfiable when the banner is taller than
 * the gap between those lines. On a short banner in a tall window the two
 * conditions could not both hold and the panel would never finish expanding at
 * all. Distance-from-centre has no such coupling — it is 0 at centre for any
 * banner of any height — and it is symmetric for free, so scrolling away
 * upwards and downwards behave identically without a second set of constants.
 *
 * The thresholds below are fractions of VIEWPORT HEIGHT, ordered outermost to
 * innermost. Between `SQUARE_UNTIL` and `GLASS_FULL_AT` the glass grows —
 * scrubbed, a pure function of offset. The white window is NOT scrubbed: it is
 * a one-shot TRIGGER (see `PANEL_SHOW_AT`).
 */

/** Beyond this the glass is a bare square. Kept LOW deliberately — the banner's
 *  centre must close to within about a third of the viewport before anything
 *  moves, so the square is on screen and legible as a square for a long stretch
 *  of scroll first. Raise it and growth starts as soon as the banner appears,
 *  and the square state is effectively never seen. */
const SQUARE_UNTIL = 0.36;

/** Inside this the glass is at full size. */
const GLASS_FULL_AT = 0.18;

/**
 * ⚠ The white window is a TRIGGER, never a scrub — scrubbed, a wheel stopping
 * mid-band parks the panel half-transparent. Crossing
 * `PANEL_SHOW_AT` inward flips `--lp-glass-panel-opacity` to 1, crossing
 * `PANEL_HIDE_AT` outward flips it to 0, and the CSS `transition` on the panel
 * rules is what makes either flip a fade — fixed duration, independent of how
 * fast anyone scrolls, never resting between states.
 *
 * Both thresholds live INSIDE `GLASS_FULL_AT` (0.18), preserving the ordering
 * that matters: the panel only ever appears in a box that has finished growing,
 * and on the way back out it is fading while the box is still full, so the
 * shrink starts on an (almost) empty glass. The gap between the two is
 * hysteresis — one value would let scroll jitter at the boundary strobe the
 * panel.
 */
const PANEL_SHOW_AT = 0.12;
const PANEL_HIDE_AT = 0.16;

/** Below this the banner is short enough that a 132px square is most of it and
 *  the growth stops reading as growth. */
const MIN_WIDTH = 700;

/** `static` — SSR / no-JS / reduced-motion / too narrow: the panel at full
 *  size, exactly as the stylesheet lays it out, nothing driven.
 *  `scrub`  — the animation. */
export type GlassScrubMode = "static" | "scrub";

export function useGlassScrub() {
  // SSR and no-JS land on `static`; only ever upgraded client-side after mount.
  const [mode, setMode] = useState<GlassScrubMode>("static");
  const bannerRef = useRef<HTMLDivElement>(null);
  const glassRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const narrow = window.matchMedia(`(max-width: ${MIN_WIDTH - 1}px)`);
    const pick = () => setMode(reduced.matches || narrow.matches ? "static" : "scrub");
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
    const banner = bannerRef.current;
    const glass = glassRef.current;
    if (!banner || !glass) return;

    let frame = 0;
    // The panel trigger's whole state. `firstRender` forces the initial write —
    // without it a scene entered mid-viewport would keep the CSS fallback value
    // until the first threshold CROSSING, which could be the wrong side.
    let panelShown = false;
    let firstRender = true;
    let fullW = 0;
    let fullH = 0;
    // Same generator hum as the hero banner's expansion (../banner-hum), one
    // voice per live seat — both `useGlassScrub` hosts (Ontology banner,
    // Connect band) get it through here. Idle until the glass actually moves.
    const hum = createBannerHum();

    /**
     * The full box is whatever the STYLESHEET says it is — `min(544px, 92%)`
     * wide and content-tall — so it is measured, never hardcoded. Clearing the
     * inline styles first is what makes that reading honest: measuring while
     * our own width is applied would just return our own last frame, and the
     * panel would ratchet smaller every resize.
     *
     * Safe to do without a flash: this runs and re-renders inside one task, so
     * the natural size is never painted.
     */
    const measure = () => {
      glass.style.width = "";
      glass.style.height = "";
      const rect = glass.getBoundingClientRect();
      fullW = rect.width;
      fullH = rect.height;
    };

    const render = () => {
      frame = 0;
      const rect = banner.getBoundingClientRect();
      const vh = window.innerHeight;

      // SIGNED distance, clamped at zero once the banner centre passes the
      // viewport centre. Approaching from below (banner still low on screen)
      // gives a positive offset that shrinks toward 0 — the growth. Scrolling
      // on PAST pushes the centre above the viewport's and the clamp holds the
      // offset at 0, so the panel stays fully open instead of closing behind
      // you (matching the hero banner, which also only reverses on scroll-UP).
      // Scrolling back up returns the offset to positive and the whole thing
      // plays in reverse.
      const offset = Math.max(0, (rect.top + rect.bottom) / 2 - vh / 2) / vh;

      const t = ease(ramp(offset, SQUARE_UNTIL, GLASS_FULL_AT));
      // The EASED value, same as the hero banner: the hum should track the
      // growth the eye sees, which slows at both ends, not the raw scroll.
      hum.update(t);
      // Exact box per frame, never a transform scale: scaling would squash the
      // window's type and stretch the glass rim with it.
      glass.style.width = `${lerp(SQUARE_PX, fullW, t)}px`;
      glass.style.height = `${lerp(SQUARE_PX, fullH, t)}px`;

      // The panel is a THRESHOLD FLIP, not a ramp — the var only ever holds 0
      // or 1, and the CSS transition on the panel rules turns the flip into a
      // fixed-duration fade. Scroll decides WHEN, never HOW FAR ALONG.
      const next = panelShown ? offset < PANEL_HIDE_AT : offset <= PANEL_SHOW_AT;
      if (next !== panelShown || firstRender) {
        panelShown = next;
        banner.style.setProperty("--lp-glass-panel-opacity", panelShown ? "1" : "0");
      }
      firstRender = false;
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(render);
    };
    const onResize = () => {
      measure();
      render();
    };
    // ⚠ bfcache revival — same rationale as use-banner-scrub.ts › onPageShow:
    // a discarded-but-latched rAF id would swallow scroll events until reload.
    // Re-measure too: the restored viewport may not match the frozen one.
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      frame = 0;
      measure();
      render();
    };

    measure();
    render();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("pageshow", onPageShow);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pageshow", onPageShow);
      // Owns oscillators and a rAF of its own; neither is reachable once this
      // effect is gone, so it has to be told.
      hum.dispose();
      // Hand the box back to the stylesheet if the mode flips out of scrub.
      glass.style.width = "";
      glass.style.height = "";
      banner.style.removeProperty("--lp-glass-panel-opacity");
    };
  }, [mode]);

  return { mode, bannerRef, glassRef };
}
