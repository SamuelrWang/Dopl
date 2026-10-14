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
 * All THREE bites exist in every pose: `topDepth` carries the top-right
 * cutout, `botDepth` the bottom-left one, `leftDepth` the top-left one (the
 * vertical pose's, 2026-10-13). Moving the bite from one to another is depths
 * crossing, which is what reads as a morph. The split positions stay fixed per
 * shape so only the depths interpolate.
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
  /** Top-left bite depth, px (down from the top edge). 0 = no bite. */
  leftDepth?: number;
  /** x where the top-left bite ends; the bite runs from the left edge to here. */
  leftSplit?: number;
}

export interface PanelShapeOpts {
  /** Outer corner radius, px. */
  radius: number;
  /** Radius on the notch's own corners, px. Same value as `radius` keeps one
   *  rounding language across the whole outline. */
  notchRadius: number;
  /** Shrink the SOLID REGION by this much, px — the rim's inner edge. */
  inset?: number;
  /**
   * Take `radius` / `notchRadius` AS GIVEN instead of offsetting them by
   * `inset`.
   *
   * The default is a true concentric offset, which is what a 1px rim wants:
   * corners tighten by the inset and the bite's concave corner opens by it,
   * so the two outlines stay parallel. A DEEP inset under that rule drives
   * the corner radius to zero — the white card sits 34px in, and 20 − 34
   * clamps to a square corner. This flag is for that caller: it insets the
   * EDGES only and lets the shape keep its own rounding.
   */
  keepRadii?: boolean;
}

/**
 * SVG path data for the panel outline in a `w × h` box.
 *
 * Clockwise from just past the top-left bite's wall (which, at depth 0, is a
 * point on the straight top edge).
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
  { radius, notchRadius, inset = 0, keepRadii = false }: PanelShapeOpts
): string {
  const x0 = inset;
  const y0 = inset;
  const x1 = Math.max(x0, w - inset);
  const y1 = Math.max(y0, h - inset);

  /** Concentric by default; `keepRadii` opts out. See the flag's note. */
  const grow = keepRadii ? 0 : inset;
  const r = clamp(radius - grow, 0, Math.min((x1 - x0) / 2, (y1 - y0) / 2));
  // Depth is inset-invariant on purpose — see the note above.
  const dT = Math.max(0, shape.topDepth);
  const dB = Math.max(0, shape.botDepth);
  const dL = Math.max(0, shape.leftDepth ?? 0);

  // The bite's wall moves INTO the solid, away from the bite: left for the
  // top-right bite, right for the bottom-left one.
  const sxSplit = clamp(shape.topSplit - inset, x0 + r, x1 - r);
  const bx = clamp(shape.botSplit + inset, x0 + r, x1 - r);
  // The top-left bite's wall moves right, into the solid; never past the
  // top-right bite's wall while THAT bite is open.
  const lx = clamp((shape.leftSplit ?? 0) + inset, x0 + r, dT > 0 ? sxSplit : x1 - r);

  const tTop = y0 + dT; // the top bite's floor
  const tBot = y1 - dB; // the bottom bite's ceiling
  const lFloor = y0 + dL; // the top-left bite's floor

  // Convex corner shrinks with the inset, concave grows. Each corner is an
  // ELLIPSE: its WIDTH keeps the full notch radius (capped only by the runs it
  // turns through), its HEIGHT is capped at half the bite's depth. So as a
  // bite closes, the two corners flatten into a long, soft ramp instead of
  // shrinking into a tiny hard step. ⚠ Capping BOTH axes at depth/2 — the
  // first cut — made the last few px of a closing bite read as two straight
  // edges joined by a jog (Samuel 2026-10-13, page 2 → 3). At depth 0 the
  // height is 0, so the commands still land collinear on the straight edge.
  //
  // Top-left: its run along the top edge reaches the top-right bite's wall
  // while that bite is open, else the far corner. ⚠ Capping it at the
  // top-right SPLIT even when that bite is closed starved the corners in the
  // narrow vertical box: the white card's split sits ~3px from its top-left
  // wall there, which rendered its bite corners at 1.5px and 4.7px instead of
  // 14 (Samuel 2026-10-13, "too sharply rounded").
  const lRunA = ((dT > 0 ? sxSplit : x1 - r) - lx) / 2;
  const lRunB = (lx - x0 - r) / 2;
  const lConvex = notchCorner(notchRadius - grow, dL, lRunA, lRunB);
  const lConcave = notchCorner(notchRadius + grow, dL, lRunA, lRunB);
  // A CLOSED top-right bite is only collinear points on the top edge; it
  // parks just right of the top-left corner (never behind it, which would
  // fold the edge back on itself) with zero-width corners. Open, it sits at
  // its split and its runs stop at the top-left wall, so the two convex
  // corners on the shared edge can never cross.
  const sx = dT > 0 ? sxSplit : clamp(Math.max(sxSplit, lx + lConvex.x), x0 + r, x1 - r);
  const tRunA = dT > 0 ? Math.min((sx - x0 - r) / 2, (sx - lx) / 2) : 0;
  const tRunB = (x1 - sx - r) / 2;
  const bRunA = (x1 - bx - r) / 2;
  const bRunB = (bx - x0 - r) / 2;
  const tConvex = notchCorner(notchRadius - grow, dT, tRunA, tRunB);
  const tConcave = notchCorner(notchRadius + grow, dT, tRunA, tRunB);
  const bConvex = notchCorner(notchRadius - grow, dB, bRunA, bRunB);
  const bConcave = notchCorner(notchRadius + grow, dB, bRunA, bRunB);

  return [
    `M ${n(lx + lConvex.x)},${n(y0)}`,
    // top edge, up to the bite
    `L ${n(sx - tConvex.x)},${n(y0)}`,
    `Q ${n(sx)},${n(y0)} ${n(sx)},${n(y0 + tConvex.y)}`,
    // down the bite's wall, then along its floor
    `L ${n(sx)},${n(tTop - tConcave.y)}`,
    `Q ${n(sx)},${n(tTop)} ${n(sx + tConcave.x)},${n(tTop)}`,
    `L ${n(x1 - r)},${n(tTop)}`,
    // top-right corner — rounded in every pose, bitten or not
    `Q ${n(x1)},${n(tTop)} ${n(x1)},${n(tTop + r)}`,
    `L ${n(x1)},${n(y1 - r)}`,
    `Q ${n(x1)},${n(y1)} ${n(x1 - r)},${n(y1)}`,
    // bottom edge leftward, into the bottom bite
    `L ${n(bx + bConvex.x)},${n(y1)}`,
    `Q ${n(bx)},${n(y1)} ${n(bx)},${n(y1 - bConvex.y)}`,
    `L ${n(bx)},${n(tBot + bConcave.y)}`,
    `Q ${n(bx)},${n(tBot)} ${n(bx - bConcave.x)},${n(tBot)}`,
    `L ${n(x0 + r)},${n(tBot)}`,
    `Q ${n(x0)},${n(tBot)} ${n(x0)},${n(tBot - r)}`,
    // up the left edge to the top-left bite's floor — the panel's own
    // top-left corner, which sits ON that floor when the bite is open
    `L ${n(x0)},${n(lFloor + r)}`,
    `Q ${n(x0)},${n(lFloor)} ${n(x0 + r)},${n(lFloor)}`,
    // along the floor, up the wall, back onto the top edge
    `L ${n(lx - lConcave.x)},${n(lFloor)}`,
    `Q ${n(lx)},${n(lFloor)} ${n(lx)},${n(lFloor - lConcave.y)}`,
    `L ${n(lx)},${n(y0 + lConvex.y)}`,
    `Q ${n(lx)},${n(y0)} ${n(lx + lConvex.x)},${n(y0)}`,
    "Z",
  ].join(" ");
}

/** A bite corner's two radii: `x` along the edge, never more than half
 *  either run it turns through; `y` down the wall, additionally never more
 *  than half the bite's depth, so it vanishes with the bite. */
function notchCorner(
  want: number,
  depth: number,
  runBefore: number,
  runAfter: number
): { x: number; y: number } {
  const x = Math.max(0, Math.min(want, runBefore, runAfter));
  return { x, y: Math.min(x, Math.max(0, depth / 2)) };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), Math.max(lo, hi));
}

/** Two decimals: enough for sub-pixel edges, short enough to keep the
 *  transitioned value readable in devtools. */
function n(v: number): string {
  return String(Math.round(v * 100) / 100);
}
