import type { CastShadow } from "./glass-tilt";

/**
 * `LiquidGlass` › `edge="rim"`: the onboarding glass's edge and drop shadow,
 * for a plain rounded rect, in CSS (Samuel 2026-10-13: the landing panels'
 * "white glow around the border" should match onboarding).
 *
 * WHY CSS AND NOT ONBOARDING'S SVG MASK. Onboarding's rim is a 4px band on the
 * outline (`GLASS_RIM_BAND`), blurred (`GLASS_RIM_BLUR` σ 2.6) and knocked out
 * outside an outline inset by `GLASS_RIM_BITE` (1.25px) — it needs a mask in
 * px because its outline is notched. A rounded rect needs none: the landing
 * panels' boxes are SCROLL-SCRUBBED every frame, and a px mask would have to
 * be rewritten per frame, while a box-shadow follows `border-radius` and the
 * box for free and carries no mask for a transformed ancestor (the hero's
 * `translate3d`) to drop.
 *
 * THE PROFILE IS MATCHED, not eyeballed. Onboarding's band, read inward from
 * the edge (Φ = normal CDF): 0 until the 1.25px knockout, then
 * Φ((x+2)/2.6) − Φ((x−2)/2.6) ≈ .51, .44, .32, .21, .06 at 1.25, 2, 3, 4, 6px.
 * An inset box-shadow with no spread on a layer itself inset 1.25px gives
 * 1 − Φ((x−1.25)/σ); σ = 3 (blur 6px) gives .50, .40, .28, .18, .06 — the
 * same curve within ~0.04 — under the same `GLINT_WHITE`.
 *
 * The drop shadow is onboarding's three layers (`GLASS_SHADOW_LAYERS`: dy 36 /
 * 12 / 2, σ 36 / 14 / 2.5, under `rgba(8,10,15,0.5)` × 1 / .75 / .5) as one
 * box-shadow list — a CSS blur radius is twice an feGaussianBlur σ.
 */

/** How far inside the outline the rim's band starts (`GLASS_RIM_BITE`). */
export const RIM_EDGE_INSET = 1.25;
/** The band's softness: CSS blur radius, σ × 2 (see the profile above). */
export const RIM_EDGE_BLUR = 6;

const DROP = [
  // Widest first: it reaches furthest toward the raised side.
  { dy: 36, blur: 72, alpha: 0.5 },
  { dy: 12, blur: 28, alpha: 0.375 },
  { dy: 2, blur: 5, alpha: 0.25 },
] as const;
/** Same reach and darkening as the onboarding cast (`castMaskShadow`). */
const CAST_REACH = 14;
const CAST_DARKEN = 0.32; // 0.5 → 0.66

/** The drop shadow, lengthened toward `(rx, ry)` (the raised side) by `mag`. */
export function rimDropShadow(rx = 0, ry = 0, mag = 0): string {
  return DROP.map((l, i) => {
    const reach = CAST_REACH / (1 + i * 1.5);
    const a = l.alpha * (1 + CAST_DARKEN * mag);
    return `${(rx * reach).toFixed(2)}px ${(l.dy + ry * reach).toFixed(2)}px ${l.blur}px rgba(8,10,15,${a.toFixed(3)})`;
  }).join(", ");
}

/** The tilt's cast for a box-shadow drop: offsets only, never a second pane. */
export const castRimShadow: CastShadow = (shadow, rx, ry, mag) => {
  shadow.style.boxShadow = rimDropShadow(rx, ry, mag);
};
