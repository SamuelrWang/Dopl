import type { EdgeSide, NodeRect, Point, SceneEdge } from "./types";

/**
 * Domain-agnostic orthogonal edge router. Given a set of edges and the
 * live node rectangles (arbitrary, user-draggable positions), it produces
 * a clean elbow polyline per edge: sides picked by relative geometry with
 * hysteresis, parallel edges in a shared corridor fanned onto distinct
 * lanes, a minimum stub off each node before the first turn, exit/entry
 * anchors spread along a node's side when several edges share it, and — for
 * a vertical run blocked by an intervening card — a side loop instead of a
 * line drawn straight through the obstacle. The result lands on
 * `SceneEdge.points`, which EdgeLayer renders verbatim (rounded corners +
 * arrowheads that terminate exactly on the node border).
 *
 * Pure and deterministic (stable in input edge order) so it unit-tests
 * without a DOM. Replaces the per-feature side/mid guessing the ontology
 * and workflow layouts used to do.
 */

export interface RouteOptions {
  /** Min straight run off a node before the first turn. */
  stub?: number;
  /** Spacing between parallel lanes in one corridor. */
  laneGap?: number;
}

export const DEFAULT_STUB = 24;
export const DEFAULT_LANE_GAP = 22;

// A vertical target must clear the best horizontal gap by this much before
// routing flips from horizontal (the layered-DAG default) to vertical — the
// hysteresis that keeps a slightly-offset neighbour from swinging sides.
const HYSTERESIS = 24;
// Corridors within this many px collapse into one lane group.
const CORRIDOR_BUCKET = 48;
// How far a side loop sits off the outer node edge (before lane fan-out).
const LOOP_INSET = 32;
// Anchor spread band along a node side when many edges share it.
const ANCHOR_MIN_T = 0.25;
const ANCHOR_MAX_T = 0.75;

type Orient = "H" | "V";
type Route = "z" | "loop";

interface Plan {
  edge: SceneEdge;
  from: NodeRect;
  to: NodeRect;
  orient: Orient;
  route: Route;
  fromSide: EdgeSide;
  toSide: EdgeSide;
  /** Base corridor coordinate (riser x for H, jog y for V, side x for loop). */
  base: number;
  corridorKey: string;
  fromT: number;
  toT: number;
  /** Lane within the corridor (assigned in pass 3). */
  laneIndex: number;
}

function centerX(r: NodeRect): number {
  return r.x + r.width / 2;
}
function centerY(r: NodeRect): number {
  return r.y + r.height / 2;
}

function anchor(r: NodeRect, side: EdgeSide, t: number): Point {
  switch (side) {
    case "top":
      return { x: r.x + r.width * t, y: r.y };
    case "bottom":
      return { x: r.x + r.width * t, y: r.y + r.height };
    case "left":
      return { x: r.x, y: r.y + r.height * t };
    case "right":
      return { x: r.x + r.width, y: r.y + r.height * t };
  }
}

function bucket(v: number): number {
  return Math.round(v / CORRIDOR_BUCKET);
}

// 0, +1, -1, +2, -2, … × gap — packs parallel lanes tight around the base
// while guaranteeing each one is distinct.
function laneOffset(index: number, gap: number): number {
  if (index === 0) return 0;
  const magnitude = Math.ceil(index / 2) * gap;
  return index % 2 === 1 ? magnitude : -magnitude;
}

/**
 * Pick the routing family for one edge from the two rects' relative
 * position. Horizontal is the default (both consumer graphs flow
 * left→right); vertical only wins when the target is clearly above/below by
 * more than the best horizontal gap plus the hysteresis band.
 */
export function chooseRouting(a: NodeRect, b: NodeRect): {
  orient: Orient;
  fromSide: EdgeSide;
  toSide: EdgeSide;
} {
  const rightGap = b.x - (a.x + a.width);
  const leftGap = a.x - (b.x + b.width);
  const downGap = b.y - (a.y + a.height);
  const upGap = a.y - (b.y + b.height);

  const h =
    rightGap >= leftGap
      ? { gap: rightGap, from: "right" as EdgeSide, to: "left" as EdgeSide }
      : { gap: leftGap, from: "left" as EdgeSide, to: "right" as EdgeSide };
  const v =
    downGap >= upGap
      ? { gap: downGap, from: "bottom" as EdgeSide, to: "top" as EdgeSide }
      : { gap: upGap, from: "top" as EdgeSide, to: "bottom" as EdgeSide };

  if (v.gap > h.gap + HYSTERESIS) {
    return { orient: "V", fromSide: v.from, toSide: v.to };
  }
  return { orient: "H", fromSide: h.from, toSide: h.to };
}

/**
 * Is a straight vertical run between `a` and `b` blocked by a third node?
 * (The classic "column → non-adjacent card in the same lane" case — a
 * straight drop would cut through the card stacked between them.)
 */
function verticalBlocked(a: NodeRect, b: NodeRect, rects: NodeRect[]): boolean {
  const top = Math.min(a.y + a.height, b.y + b.height);
  const bottom = Math.max(a.y, b.y);
  const loX = Math.min(centerX(a), centerX(b));
  const hiX = Math.max(centerX(a), centerX(b));
  for (const c of rects) {
    if (c === a || c === b) continue;
    const yOverlaps = c.y < bottom && c.y + c.height > top;
    const xOverlaps = c.x < hiX && c.x + c.width > loX;
    if (yOverlaps && xOverlaps) return true;
  }
  return false;
}

/** Longest horizontal segment's midpoint (else longest segment) — never a
 *  corner, so a label pill never straddles an elbow. */
export function labelAnchor(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0];
  let best: Point | null = null;
  let bestLen = -1;
  let bestHLen = -1;
  let bestH: Point | null = null;
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1];
    const q = points[i];
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    if (len > bestLen) {
      bestLen = len;
      best = mid;
    }
    if (p.y === q.y && len > bestHLen) {
      bestHLen = len;
      bestH = mid;
    }
  }
  return bestH ?? best ?? points[0];
}

function distributeT(count: number, index: number): number {
  if (count <= 1) return 0.5;
  return ANCHOR_MIN_T + ((ANCHOR_MAX_T - ANCHOR_MIN_T) * index) / (count - 1);
}

function clamp(v: number, lo: number, hi: number): number {
  if (hi < lo) return (lo + hi) / 2;
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Route every edge whose endpoints resolve, returning the same edges with
 * `points` (a world-space elbow polyline) filled in. Edges with a missing
 * endpoint are dropped.
 */
export function routeEdges(
  edges: SceneEdge[],
  rects: Record<string, NodeRect>,
  options: RouteOptions = {}
): SceneEdge[] {
  const stub = options.stub ?? DEFAULT_STUB;
  const laneGap = options.laneGap ?? DEFAULT_LANE_GAP;
  const allRects = Object.values(rects);

  // Pass 1 — family + sides + corridor bucket per edge.
  const plans: Plan[] = [];
  // Pass 2 seeds: how many edges share each (node, side) anchor.
  const anchorGroups = new Map<string, Plan[]>();

  for (const edge of edges) {
    const from = rects[edge.from];
    const to = rects[edge.to];
    if (!from || !to) continue;

    const picked = chooseRouting(from, to);
    const orient = picked.orient;
    let route: Route = "z";
    let fromSide = picked.fromSide;
    let toSide = picked.toSide;

    if (orient === "V" && verticalBlocked(from, to, allRects)) {
      // Loop out the near horizontal side rather than cut through the
      // obstacle: exit + enter the LEFT sides, drop down a side corridor.
      route = "loop";
      fromSide = "left";
      toSide = "left";
    }

    let base: number;
    let corridorKey: string;
    if (route === "loop") {
      base = Math.min(from.x, to.x) - LOOP_INSET;
      corridorKey = `L:${bucket(base)}`;
    } else if (orient === "H") {
      const gapMid =
        fromSide === "right"
          ? (from.x + from.width + to.x) / 2
          : (to.x + to.width + from.x) / 2;
      base = gapMid;
      corridorKey = `H:${fromSide}:${bucket(gapMid)}`;
    } else {
      const gapMid =
        fromSide === "bottom"
          ? (from.y + from.height + to.y) / 2
          : (to.y + to.height + from.y) / 2;
      base = gapMid;
      corridorKey = `V:${fromSide}:${bucket(gapMid)}`;
    }

    const plan: Plan = {
      edge,
      from,
      to,
      orient,
      route,
      fromSide,
      toSide,
      base,
      corridorKey,
      fromT: 0.5,
      toT: 0.5,
      laneIndex: 0,
    };
    plans.push(plan);
    pushGroup(anchorGroups, `${edge.from}:${fromSide}`, plan);
    pushGroup(anchorGroups, `${edge.to}:${toSide}`, plan);
  }

  // Pass 2 — spread anchors along a shared node side, ordered by the cross
  // coordinate of the far endpoint so lines don't cross at the node.
  for (const [key, group] of anchorGroups) {
    if (group.length <= 1) continue;
    const [nodeId, side] = key.split(":") as [string, EdgeSide];
    const horizontalSide = side === "left" || side === "right";
    const sorted = [...group].sort((p, q) => cross(p, nodeId, horizontalSide) - cross(q, nodeId, horizontalSide));
    sorted.forEach((plan, i) => {
      const t = distributeT(group.length, i);
      if (plan.edge.from === nodeId && plan.fromSide === side) plan.fromT = t;
      if (plan.edge.to === nodeId && plan.toSide === side) plan.toT = t;
    });
  }

  // Pass 3 — lane index within each corridor.
  const laneCounters = new Map<string, number>();
  for (const plan of plans) {
    const k = laneCounters.get(plan.corridorKey) ?? 0;
    laneCounters.set(plan.corridorKey, k + 1);
    plan.laneIndex = k;
  }

  // Pass 4 — build the polyline.
  return plans.map((plan) => buildEdge(plan, stub, laneGap));
}

function cross(plan: Plan, nodeId: string, horizontalSide: boolean): number {
  const far = plan.edge.from === nodeId ? plan.to : plan.from;
  return horizontalSide ? centerY(far) : centerX(far);
}

function buildEdge(plan: Plan, stub: number, laneGap: number): SceneEdge {
  const { from, to, fromSide, toSide, route, orient } = plan;
  const p0 = anchor(from, fromSide, plan.fromT);
  const p1 = anchor(to, toSide, plan.toT);
  const offset = laneOffset(plan.laneIndex ?? 0, laneGap);

  let points: Point[];
  if (route === "loop") {
    // Side corridor to the left of both nodes; successive loops fan outward.
    const laneX = Math.min(from.x, to.x) - LOOP_INSET - plan.laneIndex * laneGap;
    points = [p0, { x: laneX, y: p0.y }, { x: laneX, y: p1.y }, p1];
  } else if (orient === "H") {
    const lo = Math.min(p0.x, p1.x) + stub;
    const hi = Math.max(p0.x, p1.x) - stub;
    const riserX = clamp(plan.base + offset, lo, hi);
    points = [p0, { x: riserX, y: p0.y }, { x: riserX, y: p1.y }, p1];
  } else {
    const lo = Math.min(p0.y, p1.y) + stub;
    const hi = Math.max(p0.y, p1.y) - stub;
    const jogY = clamp(plan.base + offset, lo, hi);
    points = [p0, { x: p0.x, y: jogY }, { x: p1.x, y: jogY }, p1];
  }

  return { ...plan.edge, fromSide, toSide, points };
}

function pushGroup(map: Map<string, Plan[]>, key: string, plan: Plan): void {
  const arr = map.get(key);
  if (arr) arr.push(plan);
  else map.set(key, [plan]);
}
