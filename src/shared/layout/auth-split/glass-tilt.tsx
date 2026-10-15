"use client";

import { useEffect, useState, type ReactNode, type RefObject } from "react";
import {
  useGlassTilt as useSharedGlassTilt,
  type CastShadow,
  type GlassTiltRefs,
} from "@/shared/design/liquid-glass/glass-tilt";

/**
 * The onboarding glass's half of the hover tilt. The tilt itself — pointer,
 * rAF lerp, `--glass-tilt`, sheen — is the shared
 * `shared/design/liquid-glass/glass-tilt.ts` › useGlassTilt (the landing page's
 * panels wear it too); this file keeps what only the auth pane has: its
 * mask-built shadow's raised-side cast, the masked sheen, and the pane clip.
 */

export type { GlassTiltRefs };

/** Px the softest shadow layer reaches out toward the RAISED side at full tilt. */
const CAST_REACH = 14;
/** The shadow's fill alpha, flat → full tilt (the panel's own `rgba(8,10,15,0.5)`). */
const CAST_ALPHA = [0.5, 0.66] as const;

/**
 * The raised edge casts a longer, darker shadow onto the banner. ⚠ ONLY THE
 * BLURRED LAYERS MOVE — they are the mask's `fill-opacity` paths, offset from
 * their own base `translate(0,dy)` — and the KNOCKOUT (the black path) stays
 * on the glass outline. Moving the whole shadow is what drew the second pane.
 * Wider layers reach further, so the cast reads as height, not a slide.
 */
const castMaskShadow: CastShadow = (shadow, rx, ry, mag) => {
  const id = /#([^")]+)/.exec(shadow.style.mask || shadow.style.webkitMask || "")?.[1];
  const mask = id ? document.getElementById(id) : null;
  if (!mask) return;
  const layers = mask.querySelectorAll<SVGPathElement>("path[fill-opacity]");
  layers.forEach((p, i) => {
    const base = (p.dataset.baseDy ??= /translate\(0,\s*(-?[\d.]+)\)/.exec(
      p.getAttribute("transform") ?? ""
    )?.[1] ?? "0");
    // Layer 0 is the widest (see GLASS_SHADOW_LAYERS); later ones hug the edge.
    const reach = CAST_REACH / (1 + i * 1.5);
    p.setAttribute(
      "transform",
      `translate(${(rx * reach).toFixed(2)},${(Number(base) + ry * reach).toFixed(2)})`
    );
  });
  const a = CAST_ALPHA[0] + (CAST_ALPHA[1] - CAST_ALPHA[0]) * mag;
  shadow.style.background = `rgba(8,10,15,${a.toFixed(3)})`;
};

/**
 * The onboarding glass's tilt: the shared hook with this pane's cast.
 * @param enabled the panel is idle — no pose hand-off in flight.
 */
export function useGlassTilt(refs: GlassTiltRefs, enabled: boolean): void {
  useSharedGlassTilt(refs, enabled, castMaskShadow);
}

/** `prefers-reduced-motion: reduce` → the panel still changes pose, it just
 *  arrives there instantly (no transition at all, so no clip-path tween). */
export function usePrefersReducedMotion(): boolean {
  const [still, setStill] = useState(false);
  useEffect(() => {
    // No matchMedia (jsdom): motion on, like a default browser.
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setStill(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return still;
}

/**
 * True while `slotRef`'s element has children — i.e. a PAGE has portaled
 * something onto the glass (/get-started's install window). That is the
 * get-started surface's tilt opt-in: the layout persists across the auth group
 * and the page cannot hand it a prop, but the portal itself is an explicit,
 * page-owned act. Every other surface leaves the slot empty, so stays flat.
 */
export function useSlotFilled(slotRef: RefObject<HTMLElement | null>): boolean {
  const [filled, setFilled] = useState(false);
  useEffect(() => {
    const el = slotRef.current;
    if (!el) return;
    const sync = () => setFilled(el.childElementCount > 0);
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(el, { childList: true });
    return () => mo.disconnect();
  }, [slotRef]);
  return filled;
}

/**
 * The tilt's specular sheen, ON the glass. Masked to the glass outline from a
 * SIBLING of `LiquidGlass`, so no ancestor of the backdrop layer gains a mask
 * (that would make it a backdrop root and flatten the refraction). Painted by
 * `useGlassTilt`; invisible at rest.
 */
export function GlassSheen({
  sheenRef,
  maskId,
}: {
  sheenRef: RefObject<HTMLDivElement | null>;
  maskId: string;
}) {
  return (
    <div
      ref={sheenRef}
      aria-hidden
      data-glass-sheen=""
      style={{
        position: "absolute",
        inset: 0,
        mask: `url(#${maskId})`,
        WebkitMask: `url(#${maskId})`,
        opacity: 0,
        pointerEvents: "none",
        // Tilts with the glass layers — see `LiquidGlass` › LAYER_TILT.
        transform: "var(--glass-tilt, none)",
      }}
    />
  );
}

/**
 * The pane's rounded clip, holding the banner, the glass and its masks.
 *
 * ⚠ THE CORNERS ARE A `clip-path`, NOT `overflow-hidden` + `border-radius`.
 * A rounded overflow clip over a COMPOSITED descendant — the glass group, the
 * moment the tilt gives it a transform — becomes its own render surface in
 * Chromium, and the glass's backdrop-filter then samples that empty surface:
 * the glass went see-through under the tilt (Samuel 2026-10-13). Measured on
 * a striped backdrop: a plain 2D `rotate` broke it too, and radius 0 fixed
 * it. `clip-path` instead makes THIS layer the backdrop root, and it holds
 * the banner, so the refraction keeps its source. The pane's own shadow lives
 * on the parent so this clip cannot cut it off.
 */
export function PaneClip({
  paneRef,
  children,
}: {
  paneRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  return (
    <div ref={paneRef} style={{ position: "absolute", inset: 0, clipPath: "inset(0 round 32px)" }}>
      {children}
    </div>
  );
}
