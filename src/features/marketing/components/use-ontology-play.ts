"use client";

import { useEffect, useState, type RefObject } from "react";
import type { GlassScrubMode } from "./use-glass-scrub";

/** Share of the banner on screen before the active window plays. */
const PLAY_RATIO = 0.5;

/**
 * `static` | `armed` | `in` — what the Orchestration section writes as the
 * active window's `data-play` (contract: ./ontology-bits.tsx).
 *
 * `in` only when the banner is on screen AND the white window is actually
 * showing: in `scrub` mode the glass grows before the window fades in, and
 * ./use-glass-scrub.ts flips `--lp-glass-panel-opacity` (0 | 1) on the banner
 * when it does — read here off the banner's inline style through a
 * MutationObserver, the same way the landing banner demo reads its slot
 * opacity, so a window never plays its sequence unseen behind the glass.
 *
 * ⚠ `static` for SSR, no JS, no IntersectionObserver and reduced motion: no
 * `data-play` at all, so the base rules (the end frames) render, and the tour
 * never auto-advances.
 */
export type OntologyPlay = "static" | "armed" | "in";

export function useOntologyPlay(
  bannerRef: RefObject<HTMLDivElement | null>,
  glassMode: GlassScrubMode,
): OntologyPlay {
  const [enabled, setEnabled] = useState(false);
  const [onScreen, setOnScreen] = useState(false);
  const [panelShown, setPanelShown] = useState(true);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const pick = () => setEnabled(!reduced.matches);
    pick();
    reduced.addEventListener("change", pick);
    return () => reduced.removeEventListener("change", pick);
  }, []);

  useEffect(() => {
    const banner = bannerRef.current;
    if (!enabled || !banner) return;
    const io = new IntersectionObserver(
      ([entry]) => setOnScreen(entry.intersectionRatio >= PLAY_RATIO),
      { threshold: [0, PLAY_RATIO] },
    );
    io.observe(banner);
    return () => io.disconnect();
  }, [enabled, bannerRef]);

  useEffect(() => {
    const banner = bannerRef.current;
    if (!enabled || !banner || glassMode !== "scrub") return;
    const read = () =>
      setPanelShown(banner.style.getPropertyValue("--lp-glass-panel-opacity").trim() === "1");
    read();
    const mo = new MutationObserver(read);
    mo.observe(banner, { attributes: true, attributeFilter: ["style"] });
    return () => mo.disconnect();
  }, [enabled, glassMode, bannerRef]);

  if (!enabled) return "static";
  // Outside `scrub` the window is never faded, so only the scroll position counts.
  return onScreen && (glassMode !== "scrub" || panelShown) ? "in" : "armed";
}
