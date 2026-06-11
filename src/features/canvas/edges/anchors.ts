/**
 * Connector anchor geometry — shared by the ports layer (where the
 * draggable sites sit), the edge-drag ghost, and the committed edge
 * renderer so all three agree on where a connection attaches.
 *
 * Each connectable panel exposes sites at SITE_FRACTIONS along every
 * side. A committed edge re-derives a tidy attachment via facingAnchors
 * (the side of each panel that faces the other), so the rendered curve
 * stays clean regardless of which exact site the user grabbed.
 */

export type Side = "top" | "right" | "bottom" | "left";

export const SIDES: Side[] = ["top", "right", "bottom", "left"];

/** Fractional positions of the connection sites along each side —
 *  a single site at the middle of each edge. */
export const SITE_FRACTIONS = [0.5] as const;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Outward unit normal of a side (points away from the panel). */
export function sideNormal(side: Side): { nx: number; ny: number } {
  switch (side) {
    case "top":
      return { nx: 0, ny: -1 };
    case "bottom":
      return { nx: 0, ny: 1 };
    case "left":
      return { nx: -1, ny: 0 };
    case "right":
      return { nx: 1, ny: 0 };
  }
}

/** World point of a site on `side` at `frac` (0..1) along that side. */
export function sitePoint(
  p: Box,
  side: Side,
  frac: number
): { x: number; y: number } {
  switch (side) {
    case "top":
      return { x: p.x + p.width * frac, y: p.y };
    case "bottom":
      return { x: p.x + p.width * frac, y: p.y + p.height };
    case "left":
      return { x: p.x, y: p.y + p.height * frac };
    case "right":
      return { x: p.x + p.width, y: p.y + p.height * frac };
  }
}

/**
 * Pick the sides that face each other between two panels (by center
 * delta) and return the midpoint attachment points + the chosen sides
 * so the renderer can bend the curve out of each side's normal.
 */
export function facingAnchors(
  from: Box,
  to: Box
): {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  fromSide: Side;
  toSide: Side;
} {
  const fcx = from.x + from.width / 2;
  const fcy = from.y + from.height / 2;
  const tcx = to.x + to.width / 2;
  const tcy = to.y + to.height / 2;
  const dx = tcx - fcx;
  const dy = tcy - fcy;

  let fromSide: Side;
  let toSide: Side;
  if (Math.abs(dx) >= Math.abs(dy)) {
    fromSide = dx >= 0 ? "right" : "left";
    toSide = dx >= 0 ? "left" : "right";
  } else {
    fromSide = dy >= 0 ? "bottom" : "top";
    toSide = dy >= 0 ? "top" : "bottom";
  }

  const a = sitePoint(from, fromSide, 0.5);
  const b = sitePoint(to, toSide, 0.5);
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y, fromSide, toSide };
}

/**
 * Path between two anchors. Straight line when the anchors are already
 * (near-)aligned along the exit axis — a curve there reads as wobble —
 * and a gentle cubic out of each side's normal otherwise, with the bend
 * sized by how far out of alignment the endpoints actually are, so the
 * line only curves as much as it needs to.
 */
export function edgePath(a: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  fromSide: Side;
  toSide: Side;
}): string {
  const fn = sideNormal(a.fromSide);
  const tn = sideNormal(a.toSide);
  const dx = a.x2 - a.x1;
  const dy = a.y2 - a.y1;

  // Offset perpendicular to the exit direction: 0 means the endpoints
  // line up with the from-side's normal and a straight line is clean.
  const perp = fn.nx !== 0 ? Math.abs(dy) : Math.abs(dx);
  if (perp < 6 && a.fromSide !== a.toSide) {
    return `M ${a.x1} ${a.y1} L ${a.x2} ${a.y2}`;
  }

  const dist = Math.hypot(dx, dy);
  // Bend grows with misalignment, capped well below the old dist/2
  // (which ballooned long edges into deep U-curves).
  const bend = Math.min(Math.max(perp * 0.6, 24), dist * 0.4, 110);
  const c1x = a.x1 + fn.nx * bend;
  const c1y = a.y1 + fn.ny * bend;
  const c2x = a.x2 + tn.nx * bend;
  const c2y = a.y2 + tn.ny * bend;
  return `M ${a.x1} ${a.y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${a.x2} ${a.y2}`;
}
