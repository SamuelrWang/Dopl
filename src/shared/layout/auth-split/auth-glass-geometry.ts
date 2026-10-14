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
 * ⚠ ONE ELEMENT, FOUR POSES. The panel is never remounted or keyed per pose:
 * it is the same node with animated insets and an animated outline, which is
 * the only way the slide and the morph can be continuous. A caller changing
 * pose mid-flow must therefore keep this layout mounted — which onboarding
 * does, since its step lives in state inside the flow, not in a route.
 *
 * `"default"` is the historical render: centred, plain rounded rect, and NO
 * clip path or transition at all, so login and the web auth group are
 * untouched.
 *
 * `"vertical-left-top-notch"` (onboarding step 3, Samuel 2026-10-13) is the
 * same panel turned on its side — width and height swapped — against the
 * pane's LEFT edge, with the bite at the top-left. It is the one pose whose
 * BOX differs, so the box (not just the outline) morphs: see `glassBox`.
 */
export type AuthGlassPose =
  | "default"
  | "lowered-top-notch"
  | "raised-bottom-notch"
  | "vertical-left-top-notch";

/** Glass geometry, as fractions of the banner pane, for the three HORIZONTAL
 *  poses (height pose-invariant: only the top inset moves). The vertical pose
 *  swaps the resulting width and height — see `glassBox`. */
export const GLASS_SIDE_INSET = 0.08;
export const GLASS_HEIGHT = 0.36;
export const GLASS_MIN_H = 220;
/** Top inset per pose. `lowered` puts the bottom inset at 8%, equal to the
 *  sides (1 - 0.08 - 0.36 = 0.56); `raised` puts the top inset there. */
export const GLASS_TOP: Record<Exclude<AuthGlassPose, "vertical-left-top-notch">, number> = {
  default: 0.32,
  "lowered-top-notch": 0.56,
  "raised-bottom-notch": 0.08,
};

/** The glass's box inside the pane, px. */
export interface GlassBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where the glass sits in a `paneW × paneH` pane, per pose. The horizontal
 * poses are the historical percentages (8% side insets, 36% tall with a 220px
 * floor, `GLASS_TOP` down). The vertical pose is that box's size TRANSPOSED
 * and then widened by `GLASS_V_WIDEN` (Samuel 2026-10-13, "slightly more
 * width"), against the left edge at the same 8% inset, centred vertically —
 * height capped to the pane's with the same margins so a short window cannot
 * push it out, width capped to the pane's minus both insets.
 */
export function glassBox(pose: AuthGlassPose, paneW: number, paneH: number): GlassBox {
  const w = paneW * (1 - GLASS_SIDE_INSET * 2);
  const h = Math.max(GLASS_MIN_H, paneH * GLASS_HEIGHT);
  if (pose === "vertical-left-top-notch") {
    const vh = Math.min(w, paneH * (1 - GLASS_SIDE_INSET * 2));
    return { x: paneW * GLASS_SIDE_INSET, y: (paneH - vh) / 2, w: Math.min(w, h * GLASS_V_WIDEN), h: vh };
  }
  return { x: paneW * GLASS_SIDE_INSET, y: paneH * GLASS_TOP[pose], w, h };
}

export const GLASS_RADIUS = 20;
/** The bite's corners round exactly like the panel's own, so the outline has
 *  one rounding language rather than two. */
export const GLASS_NOTCH_RADIUS = GLASS_RADIUS;
/** The bite is exactly a third of the panel's width, in every pose. */
const GLASS_NOTCH_SPAN = 1 / 3;
const GLASS_NOTCH_DEPTH = 0.38;
/** The vertical pose's width over the transposed horizontal box's. */
const GLASS_V_WIDEN = 1.12;
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
/** Grace after the card's fade-out before the glass (and the card's content)
 *  swap to the next pose — see `auth-banner-panel.tsx` › AuthBannerPanel. */
export const CARD_SWAP_SLACK_MS = 60;
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

/** The three bite depths, px. */
export interface BiteDepths {
  top: number;
  bot: number;
  left: number;
}

export function glassShape(w: number, d: BiteDepths): PanelShape {
  return {
    // Fixed splits (fractions of the width) in every pose, so an outline
    // change interpolates depth only. Top bite runs from 2/3 across to the
    // right edge; bottom bite from the left edge to 1/3 across. Both are one
    // third wide. The top-left bite is the top-right one TURNED: as wide as
    // that one is deep (`GLASS_NOTCH_DEPTH` of the width), and a little
    // only as deep as makes the card's strip beside it square (`poseDepths`).
    topSplit: w * (1 - GLASS_NOTCH_SPAN),
    botSplit: w * GLASS_NOTCH_SPAN,
    leftSplit: w * GLASS_NOTCH_DEPTH,
    topDepth: d.top,
    botDepth: d.bot,
    leftDepth: d.left,
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
  return panelPath(w, h, glassShape(w, poseDepths(pose, w, h)), {
    radius: CARD_RADIUS,
    notchRadius: CARD_RADIUS,
    inset: CARD_INSET,
    // Edges in by `CARD_INSET`, rounding left alone: a concentric offset this
    // deep would square the corners off (20 − 34 clamps to 0).
    keepRadii: true,
  });
}

/**
 * Bite depths the pose is heading for, in a `w × h` box.
 *
 * ⚠ THE VERTICAL POSE'S DEPTH IS THE CARD STRIP'S WIDTH. The strip beside its
 * bite (`cardRegions` › side) runs from the bite's wall + `CARD_INSET` to the
 * card's right edge, and is exactly as tall as the bite is deep — so this
 * depth makes that strip SQUARE at every window size. Step 3's line in it is
 * four set lines whose block is square too (Charter italic, measured: 4.86 ×
 * 4.88 font sizes), so a font sized off the strip's width leaves the SAME gap
 * on all four sides (Samuel 2026-10-13: "the top and bottom border around the
 * text is the same as the left and right"). A fixed fraction of the height
 * (0.25, then) left the strip ~40px taller than wide at some windows.
 */
export function poseDepths(pose: AuthGlassPose, w: number, h: number): BiteDepths {
  const d = h * GLASS_NOTCH_DEPTH;
  const strip = w * (1 - GLASS_NOTCH_DEPTH) - CARD_INSET * 2;
  return {
    top: pose === "lowered-top-notch" ? d : 0,
    bot: pose === "raised-bottom-notch" ? d : 0,
    left: pose === "vertical-left-top-notch" ? Math.max(0, Math.min(strip, h / 2)) : 0,
  };
}

/** An axis-aligned rect inside the glass box, px. */
export interface CardRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The white card cut into its two RECTANGLES, for content laid out on it.
 *
 * A bitten card is an L: `main` is the full-height part beside the bite, and
 * `side` the shorter part under (lowered) or over (raised) it, between the
 * bite's wall and the card's far edge. The vertical pose turns that: `main`
 * is the full-WIDTH part under its top-left bite, `side` the strip beside it. `"default"` has no bite, so it is all
 * `main` and `side` is null.
 *
 * Derived from the SAME numbers `cardPath` draws with — the inset edges, the
 * bite's wall moved `CARD_INSET` into the solid and its floor/ceiling
 * `CARD_INSET` past the bite — so content placed here can never cross the
 * card's outline. Rounded corners are not subtracted: callers pad.
 */
export function cardRegions(
  pose: AuthGlassPose,
  w: number,
  h: number
): { main: CardRect; side: CardRect | null } {
  const x0 = CARD_INSET;
  const y0 = CARD_INSET;
  const x1 = Math.max(x0, w - CARD_INSET);
  const y1 = Math.max(y0, h - CARD_INSET);
  const full = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  const depths = poseDepths(pose, w, h);
  const { top, bot, left } = depths;
  const { topSplit, botSplit, leftSplit = 0 } = glassShape(w, depths);
  if (left > 0) {
    // Vertical: `main` is the full-width part under the bite, `side` the
    // strip beside the bite, from its wall to the card's far edge.
    const wall = leftSplit + CARD_INSET;
    return {
      main: { x: x0, y: y0 + left, w: x1 - x0, h: Math.max(0, y1 - y0 - left) },
      side: { x: wall, y: y0, w: Math.max(0, x1 - wall), h: left },
    };
  }
  if (top > 0) {
    const wall = topSplit - CARD_INSET;
    return {
      main: { ...full, w: Math.max(0, wall - x0) },
      side: { x: wall, y: y0 + top, w: Math.max(0, x1 - wall), h: Math.max(0, y1 - y0 - top) },
    };
  }
  if (bot > 0) {
    const wall = botSplit + CARD_INSET;
    return {
      main: { ...full, x: wall, w: Math.max(0, x1 - wall) },
      side: { x: x0, y: y0, w: Math.max(0, wall - x0), h: Math.max(0, y1 - y0 - bot) },
    };
  }
  return { main: full, side: null };
}
