/**
 * The glass panel's geometry: its numbers, its pose type, and the pure path
 * math both of the other two files need. Split out of
 * `./auth-split-layout.tsx` (2026-10-11) to stay under the 500-line cap
 * (INVARIANTS §1).
 *
 * No React and no `"use client"`: this is constants plus pure functions, so
 * `./auth-split-layout.tsx` can take `AuthGlassPose` as a TYPE import (erased)
 * and the only runtime edge is layout → panel → here.
 */

import { panelPath, type PanelShape } from "./panel-shape";

/**
 * Where the glass panel sits and which edge is bitten.
 *
 * ⚠ ONE ELEMENT, THREE POSES. The panel is never remounted or keyed per pose:
 * it is the same node with animated insets and an animated outline, which is
 * the only way the slide and the morph can be continuous. A caller changing
 * pose mid-flow must therefore keep this layout mounted — which onboarding
 * does, since its step lives in state inside the flow, not in a route.
 *
 * `"default"` is the historical render: centred, plain rounded rect, and NO
 * clip path or transition at all, so login and the web auth group are
 * untouched.
 */
export type AuthGlassPose = "default" | "lowered-top-notch" | "raised-bottom-notch";

/** Glass geometry, as fractions of the banner pane. Height is pose-invariant:
 *  only the top inset moves, so the slide is one animated property. */
export const GLASS_SIDE_INSET = 0.08;
export const GLASS_HEIGHT = 0.36;
export const GLASS_MIN_H = 220;
/** Top inset per pose. `lowered` puts the bottom inset at 8%, equal to the
 *  sides (1 - 0.08 - 0.36 = 0.56); `raised` puts the top inset there. */
export const GLASS_TOP: Record<AuthGlassPose, number> = {
  default: 0.32,
  "lowered-top-notch": 0.56,
  "raised-bottom-notch": 0.08,
};

export const GLASS_RADIUS = 20;
/** The bite's corners round exactly like the panel's own, so the outline has
 *  one rounding language rather than two. */
export const GLASS_NOTCH_RADIUS = GLASS_RADIUS;
/** The bite is exactly a third of the panel's width, in every pose. */
const GLASS_NOTCH_SPAN = 1 / 3;
const GLASS_NOTCH_DEPTH = 0.38;
/** Rim band width and softness, tuned to read like the glint's
 *  `inset 1.5px 1.5px 4px` bevel rather than a drawn line. */
// ⚠ Thin core, wide falloff — the glint this imitates is
// `inset 1.5px 1.5px 4px`, i.e. a ~1.5px core under a 4px blur. The first
// cut used a 7px band under a 2px blur, which is a ~3.5px core: invisible
// against page 1's dark forest, but a drawn white stroke against page 2's
// bright sky, which is the asymmetry Samuel reported (#3112). Measured: the
// band is no stronger on page 2 (peak delta 49) than page 1 (77) — only the
// backdrop changed, so the fix is the profile, not the placement.
export const GLASS_RIM_BAND = 4;
export const GLASS_RIM_BLUR = 2.6;
/** How far the rim's knockout reaches INTO the solid, to bury its own
 *  antialiased edge. See the `rimClip` write. */
export const GLASS_RIM_BITE = 1.25;

/**
 * The drop shadow, as the THREE layers the unshaped panel's box-shadow has
 * (`0 2px 5px .35`, `0 12px 28px .45`, `0 36px 72px .55`). One tight dark
 * layer on its own reads as a drawn outline, which is what a single
 * blur-13 pass gave — a CSS blur radius is about twice an feGaussianBlur
 * `stdDeviation`, so 72px of CSS softness is 36 here, not 13.
 */
export const GLASS_SHADOW_LAYERS = [
  { dy: 36, std: 36, alpha: 1 },
  { dy: 12, std: 14, alpha: 0.75 },
  { dy: 2, std: 2.5, alpha: 0.5 },
];
/** Room around the panel for the widest layer to fall into. */
export const GLASS_SHADOW_PAD = 160;

/** Slow out of rest, accelerate, settle in. */
export const GLASS_EASE = "cubic-bezier(0.65, 0, 0.35, 1)";
export const GLASS_MS = 820;

/**
 * THE WHITE CARD ON THE GLASS, and its hand-off with the slide.
 *
 * The card never travels. It fades out, the glass moves and morphs with
 * nothing on it, then the card fades in at its new size and place. So the
 * glass is BARE for the whole move, and the two never overlap.
 */
export const CARD_OUT_MS = 300;
export const CARD_IN_MS = 400;
export const CARD_EASE = "ease-out";
/** Even margin between the card's outline and the glass's, all the way round
 *  — including along the bite. */
const CARD_INSET = 34;
/** ⚠ KEEP IN SYNC with `--glass-card-radius` (globals.css + the desktop
 *  tokens mirror). The card is a MASK now, so `border-radius` no longer
 *  applies to it and the number has to exist in JS as well. */
const CARD_RADIUS = 14;

/** The JS twin of {@link GLASS_EASE} — the morph is driven frame by frame, the
 *  slide by CSS, and they have to arrive together. */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function glassShape(w: number, topDepth: number, botDepth: number): PanelShape {
  return {
    // Fixed splits in every pose, so an outline change interpolates depth
    // only. Top bite runs from 2/3 across to the right edge; bottom bite from
    // the left edge to 1/3 across. Both are one third wide.
    topSplit: w * (1 - GLASS_NOTCH_SPAN),
    botSplit: w * GLASS_NOTCH_SPAN,
    topDepth,
    botDepth,
  };
}

/**
 * The card's rect inside the glass box, for a pose.
 *
 * ⚠ Measured from the SOLID part, never the whole box: the bite is a hole, so
 * the card insets from the bite's floor (lowered) or its ceiling (raised),
 * which is also what repositions it per page.
 */
export function cardPath(pose: AuthGlassPose, w: number, h: number): string {
  const { top, bot } = poseDepths(pose, h);
  return panelPath(w, h, glassShape(w, top, bot), {
    radius: CARD_RADIUS,
    notchRadius: CARD_RADIUS,
    inset: CARD_INSET,
    // Edges in by `CARD_INSET`, rounding left alone: a concentric offset this
    // deep would square the corners off (20 − 34 clamps to 0).
    keepRadii: true,
  });
}

/** Bite depths the pose is heading for. */
export function poseDepths(pose: AuthGlassPose, h: number): { top: number; bot: number } {
  const d = h * GLASS_NOTCH_DEPTH;
  return {
    top: pose === "lowered-top-notch" ? d : 0,
    bot: pose === "raised-bottom-notch" ? d : 0,
  };
}
