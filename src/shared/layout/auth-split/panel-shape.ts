/**
 * The auth glass panel's outline, as ONE interpolable path.
 *
 * ⚠ THE WHOLE POINT: every pose emits the SAME command sequence — same count,
 * same types, same order — so `clip-path: path(…)` morphs between them instead
 * of snapping. A "flat" edge is therefore NOT a shorter path: it is the notched
 * path with the bite's depth at zero and its corner radius collapsed, which
 * leaves the notch's vertices sitting collinear on the straight edge. Never
 * "optimize" a degenerate command away — that is exactly the snap this avoids.
 *
 * Both bites exist in every pose: `topDepth` carries the top-right cutout,
 * `botDepth` the bottom-left one. Moving the bite from one to the other is two
 * depths crossing, which is what reads as a morph. The split positions stay
 * fixed per shape so only the depths interpolate.
 */

export interface PanelShape {
  /** Top-edge bite depth, px. 0 = straight top edge. */
  topDepth: number;
  /** x where the top bite begins; the bite runs from here to the right edge. */
  topSplit: number;
  /** Bottom-edge bite depth, px. 0 = straight bottom edge. */
  botDepth: number;
  /** x where the bottom bite ends; the bite runs from the left edge to here. */
  botSplit: number;
}

export interface PanelShapeOpts {
  /** Outer corner radius, px. */
  radius: number;
  /** Radius on the notch's own corners, px. Same value as `radius` keeps one
   *  rounding language across the whole outline. */
  notchRadius: number;
  /** Shrink the SOLID REGION by this much, px — the rim's inner edge. */
  inset?: number;
}

/**
 * SVG path data for the panel outline in a `w × h` box.
 *
 * Clockwise from just past the top-left corner.
 *
 * ⚠ `inset` shrinks THE SOLID REGION, which is not the same as subtracting
 * from every number. A bite is a hole in the solid, so its surfaces move the
 * OPPOSITE way from the outer edges:
 *   - outer edges move inward   (x0 += inset, y1 -= inset, …)
 *   - the bite's floor moves DOWN and its wall moves toward the solid, i.e.
 *     the bite GROWS by the same amount.
 * Expressed here as: depth is left ALONE (the floor rides the already-inset
 * top edge, so it lands `inset` lower), and the split shifts away from the
 * bite. Subtracting `inset` from the depth instead — the first cut of this
 * file — made the inner path's wall and floor coincide with the outer's, which
 * gave the rim zero width along the notch and left hairline slivers where the
 * two paths met. That is the "stray edges at the notch corners" bug.
 *
 * Corner radii follow the same logic: the bite's outer corner is convex and
 * shrinks by `inset`, its inner corner is concave and grows by it.
 */
export function panelPath(
  w: number,
  h: number,
  shape: PanelShape,
  { radius, notchRadius, inset = 0 }: PanelShapeOpts
): string {
  const x0 = inset;
  const y0 = inset;
  const x1 = Math.max(x0, w - inset);
  const y1 = Math.max(y0, h - inset);

  const r = clamp(radius - inset, 0, Math.min((x1 - x0) / 2, (y1 - y0) / 2));
  // Depth is inset-invariant on purpose — see the note above.
  const dT = Math.max(0, shape.topDepth);
  const dB = Math.max(0, shape.botDepth);

  // The bite's wall moves INTO the solid, away from the bite: left for the
  // top-right bite, right for the bottom-left one.
  const sx = clamp(shape.topSplit - inset, x0 + r, x1 - r);
  const bx = clamp(shape.botSplit + inset, x0 + r, x1 - r);

  const tTop = y0 + dT; // the top bite's floor
  const tBot = y1 - dB; // the bottom bite's ceiling

  // Convex corner shrinks with the inset, concave grows. BOTH are capped at
  // half the bite's depth, so at depth 0 they collapse to 0 together and the
  // bite's four commands land collinear on the straight edge, drawing nothing.
  const tConvex = notchCorner(notchRadius - inset, dT, (sx - x0 - r) / 2, (x1 - sx - r) / 2);
  const tConcave = notchCorner(notchRadius + inset, dT, (sx - x0 - r) / 2, (x1 - sx - r) / 2);
  const bConvex = notchCorner(notchRadius - inset, dB, (x1 - bx - r) / 2, (bx - x0 - r) / 2);
  const bConcave = notchCorner(notchRadius + inset, dB, (x1 - bx - r) / 2, (bx - x0 - r) / 2);

  return [
    `M ${n(x0 + r)},${n(y0)}`,
    // top edge, up to the bite
    `L ${n(sx - tConvex)},${n(y0)}`,
    `Q ${n(sx)},${n(y0)} ${n(sx)},${n(y0 + tConvex)}`,
    // down the bite's wall, then along its floor
    `L ${n(sx)},${n(tTop - tConcave)}`,
    `Q ${n(sx)},${n(tTop)} ${n(sx + tConcave)},${n(tTop)}`,
    `L ${n(x1 - r)},${n(tTop)}`,
    // top-right corner — rounded in every pose, bitten or not
    `Q ${n(x1)},${n(tTop)} ${n(x1)},${n(tTop + r)}`,
    `L ${n(x1)},${n(y1 - r)}`,
    `Q ${n(x1)},${n(y1)} ${n(x1 - r)},${n(y1)}`,
    // bottom edge leftward, into the bottom bite
    `L ${n(bx + bConvex)},${n(y1)}`,
    `Q ${n(bx)},${n(y1)} ${n(bx)},${n(y1 - bConvex)}`,
    `L ${n(bx)},${n(tBot + bConcave)}`,
    `Q ${n(bx)},${n(tBot)} ${n(bx - bConcave)},${n(tBot)}`,
    `L ${n(x0 + r)},${n(tBot)}`,
    `Q ${n(x0)},${n(tBot)} ${n(x0)},${n(tBot - r)}`,
    `L ${n(x0)},${n(y0 + r)}`,
    `Q ${n(x0)},${n(y0)} ${n(x0 + r)},${n(y0)}`,
    "Z",
  ].join(" ");
}

/** A bite corner: never more than half the bite's depth (so it vanishes with
 *  the bite), nor more than half either run it turns through. */
function notchCorner(want: number, depth: number, runBefore: number, runAfter: number): number {
  return Math.max(0, Math.min(want, depth / 2, runBefore, runAfter));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), Math.max(lo, hi));
}

/** Two decimals: enough for sub-pixel edges, short enough to keep the
 *  transitioned value readable in devtools. */
function n(v: number): string {
  return String(Math.round(v * 100) / 100);
}
