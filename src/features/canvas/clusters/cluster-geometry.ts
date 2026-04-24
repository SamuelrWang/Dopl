/**
 * Cluster geometry — rectilinear union outline computation.
 *
 * Problem: given N axis-aligned rectangles (panels, padded), produce a
 * single outline polygon that hugs their union. For small N (cluster
 * members) we can afford an O(n²)-cell algorithm without worrying.
 *
 * Strategy:
 *   1. Pad each rect outward by CLUSTER_PADDING.
 *   2. Collect all distinct x-edges and y-edges — these define a grid of
 *      cells covering the overall bounding box.
 *   3. Classify each cell as "inside" (center is inside any padded rect)
 *      or "outside".
 *   4. Walk the boundary between inside and outside cells to produce an
 *      ordered list of vertices. This is the classic marching-grid
 *      outline trace for axis-aligned shapes.
 *   5. Simplify the polygon by dropping collinear consecutive vertices
 *      so the SVG path has the "few extra sides" the user asked for.
 *   6. Emit an SVG path string that traces the polygon with rounded
 *      corners (quarter-circle arcs at each vertex, radius CLUSTER_CORNER_RADIUS).
 *
 * For N=2–10 panels with a tight auto-layout grid, the output is a
 * rounded rectangle (single 4-vertex path). As panels drift apart, the
 * polygon grows extra sides naturally.
 */

import type { Cluster, Panel } from "../types";
import {
  CLUSTER_CORNER_RADIUS,
  CLUSTER_MEMBERSHIP_DISTANCE,
  CLUSTER_PADDING,
  MIN_CLUSTER_SIZE,
} from "../types";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Padded bounding box of a single panel, in world coords. */
export function paddedPanelRect(panel: Panel, padding = CLUSTER_PADDING): Rect {
  return {
    x: panel.x - padding,
    y: panel.y - padding,
    width: panel.width + padding * 2,
    height: panel.height + padding * 2,
  };
}

/** AABB of the union of panels (not the padded outline — just the raw bbox). */
export function panelsBoundingBox(panels: Panel[]): Rect {
  if (panels.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of panels) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x + p.width > maxX) maxX = p.x + p.width;
    if (p.y + p.height > maxY) maxY = p.y + p.height;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Returns the bounds of the cluster OUTLINE (panels + padding). Used for
 * hit-testing (is the cursor inside a cluster?) and positioning the
 * header tab.
 */
export function clusterBounds(panels: Panel[]): Rect {
  const inner = panelsBoundingBox(panels);
  return {
    x: inner.x - CLUSTER_PADDING,
    y: inner.y - CLUSTER_PADDING,
    width: inner.width + CLUSTER_PADDING * 2,
    height: inner.height + CLUSTER_PADDING * 2,
  };
}

/**
 * Check if a point is inside the cluster's actual shape — i.e. within
 * CLUSTER_PADDING of any member panel. This is tighter than `clusterBounds`
 * (padded AABB) and avoids triggering drags from empty corners.
 */
export function isPointInClusterShape(
  panels: Panel[],
  point: Point,
  padding = CLUSTER_PADDING
): boolean {
  for (const panel of panels) {
    const pr = paddedPanelRect(panel, padding);
    if (
      point.x >= pr.x &&
      point.x < pr.x + pr.width &&
      point.y >= pr.y &&
      point.y < pr.y + pr.height
    ) {
      return true;
    }
  }
  return false;
}

/** Point-in-rect hit test. Exclusive on the far edges. */
export function pointInRect(p: Point, r: Rect): boolean {
  return (
    p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height
  );
}

/**
 * Euclidean distance between two axis-aligned rectangles. Zero if they
 * overlap or touch. Used by the cluster membership re-computation during
 * panel drags.
 */
export function rectDistance(a: Rect, b: Rect): number {
  const dx = Math.max(0, Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width)));
  const dy = Math.max(
    0,
    Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height))
  );
  return Math.sqrt(dx * dx + dy * dy);
}

/** Distance between the bbox of two panels (shortcut for `rectDistance`). */
export function panelDistance(a: Panel, b: Panel): number {
  return rectDistance(
    { x: a.x, y: a.y, width: a.width, height: a.height },
    { x: b.x, y: b.y, width: b.width, height: b.height }
  );
}

/**
 * Decide which cluster (if any) a panel should belong to given the
 * current panels-with-positions and the current cluster set. Called
 * during panel drags to auto-join / auto-leave clusters based on
 * distance thresholds.
 *
 * Rules:
 *  - If the panel is currently in a cluster AND still within
 *    CLUSTER_MEMBERSHIP_DISTANCE of at least one other member of that
 *    cluster → stay (returns the current cluster id).
 *  - Otherwise, check every OTHER cluster. If the panel is within
 *    CLUSTER_MEMBERSHIP_DISTANCE of any member of a given cluster,
 *    join it (returns that cluster's id).
 *  - Otherwise return null (panel should be unclustered).
 *
 * NOTE: this function operates on the POST-move panel positions. The
 * caller is responsible for passing the panels array with the moving
 * panel's new (x, y) already applied.
 */
export function computeIdealClusterMembership(
  movedPanelId: string,
  panels: Panel[],
  clusters: Cluster[]
): string | null {
  const movedPanel = panels.find((p) => p.id === movedPanelId);
  if (!movedPanel) return null;

  const currentCluster = clusters.find((c) =>
    c.panelIds.includes(movedPanelId)
  );

  // Step 1: if already in a cluster, check whether we should stay.
  if (currentCluster) {
    // Need at least one other member within the grace zone to stay.
    let minDist = Infinity;
    for (const id of currentCluster.panelIds) {
      if (id === movedPanelId) continue;
      const other = panels.find((p) => p.id === id);
      if (!other) continue;
      const d = panelDistance(movedPanel, other);
      if (d < minDist) minDist = d;
    }
    if (minDist <= CLUSTER_MEMBERSHIP_DISTANCE) {
      // Still attached — stay put.
      return currentCluster.id;
    }
    // Fell out of range — fall through to check for a new cluster.
  }

  // Step 2: scan every other cluster for an in-range candidate.
  for (const cluster of clusters) {
    if (cluster.id === currentCluster?.id) continue;
    // Exclude the moved panel itself from the candidates.
    let minDist = Infinity;
    for (const id of cluster.panelIds) {
      if (id === movedPanelId) continue;
      const member = panels.find((p) => p.id === id);
      if (!member) continue;
      const d = panelDistance(movedPanel, member);
      if (d < minDist) minDist = d;
    }
    if (minDist <= CLUSTER_MEMBERSHIP_DISTANCE) {
      // A cluster auto-join requires the TARGET cluster to still have
      // at least MIN_CLUSTER_SIZE members (otherwise it wouldn't exist
      // in the current state anyway). This is a safety check — the
      // reducer also enforces the floor.
      if (cluster.panelIds.length >= MIN_CLUSTER_SIZE) {
        return cluster.id;
      }
    }
  }

  // Step 3: not in range of anything → no cluster.
  return null;
}

/**
 * Check whether a point lies inside ANY of a set of rects.
 * Used to classify cell centers as inside/outside the union.
 */
function pointInAny(p: Point, rects: Rect[]): boolean {
  for (const r of rects) if (pointInRect(p, r)) return true;
  return false;
}

/** Deduplicate + sort numerically. */
function sortedUnique(values: number[]): number[] {
  return Array.from(new Set(values)).sort((a, b) => a - b);
}

/**
 * Build the cell grid classification: a 2D boolean array where
 * `grid[row][col]` is true iff the cell at (xs[col]..xs[col+1], ys[row]..ys[row+1])
 * has its center inside any of the padded rects.
 */
interface CellGrid {
  xs: number[];
  ys: number[];
  inside: boolean[][]; // [row][col]
}

function buildCellGrid(rects: Rect[]): CellGrid {
  const rawXs: number[] = [];
  const rawYs: number[] = [];
  for (const r of rects) {
    rawXs.push(r.x, r.x + r.width);
    rawYs.push(r.y, r.y + r.height);
  }
  const xs = sortedUnique(rawXs);
  const ys = sortedUnique(rawYs);

  const inside: boolean[][] = [];
  for (let row = 0; row < ys.length - 1; row++) {
    const rowArr: boolean[] = [];
    const cy = (ys[row] + ys[row + 1]) / 2;
    for (let col = 0; col < xs.length - 1; col++) {
      const cx = (xs[col] + xs[col + 1]) / 2;
      rowArr.push(pointInAny({ x: cx, y: cy }, rects));
    }
    inside.push(rowArr);
  }
  return { xs, ys, inside };
}

/**
 * Trace the outline(s) of the "inside" region of a cell grid. Returns
 * ONE polygon per connected component — supporting clusters whose
 * panels are far enough apart that their padded rects don't touch.
 *
 * Algorithm:
 *   1. For every "inside" cell, emit one directed segment for each edge
 *      whose neighbour is "outside". Direction is chosen so walking the
 *      segments head-to-tail traces the component clockwise.
 *   2. Build a lookup `byStart` keyed on segment start points.
 *   3. Repeatedly pick the first unused segment as the start of a new
 *      polygon and chain segments from its endpoint until we return to
 *      the start. Mark every segment used in this loop.
 *   4. Continue until every segment has been consumed. Each loop is one
 *      connected component of the union.
 */
function traceOutlines(grid: CellGrid): Point[][] {
  const { xs, ys, inside } = grid;
  const rows = inside.length;
  if (rows === 0) return [];
  const cols = inside[0].length;

  type Seg = { a: Point; b: Point };
  const segs: Seg[] = [];

  const isInside = (r: number, c: number): boolean => {
    if (r < 0 || r >= rows || c < 0 || c >= cols) return false;
    return inside[r][c];
  };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!inside[r][c]) continue;
      const x1 = xs[c];
      const x2 = xs[c + 1];
      const y1 = ys[r];
      const y2 = ys[r + 1];

      // Top edge (left → right when walking clockwise)
      if (!isInside(r - 1, c)) {
        segs.push({ a: { x: x1, y: y1 }, b: { x: x2, y: y1 } });
      }
      // Right edge (top → bottom)
      if (!isInside(r, c + 1)) {
        segs.push({ a: { x: x2, y: y1 }, b: { x: x2, y: y2 } });
      }
      // Bottom edge (right → left)
      if (!isInside(r + 1, c)) {
        segs.push({ a: { x: x2, y: y2 }, b: { x: x1, y: y2 } });
      }
      // Left edge (bottom → top)
      if (!isInside(r, c - 1)) {
        segs.push({ a: { x: x1, y: y2 }, b: { x: x1, y: y1 } });
      }
    }
  }

  if (segs.length === 0) return [];

  const keyOf = (p: Point) => `${p.x},${p.y}`;
  const byStart = new Map<string, Seg[]>();
  for (const s of segs) {
    const k = keyOf(s.a);
    const arr = byStart.get(k);
    if (arr) arr.push(s);
    else byStart.set(k, [s]);
  }

  const used = new Set<Seg>();
  const polygons: Point[][] = [];
  const safetyLimit = segs.length * 2;

  for (const startSeg of segs) {
    if (used.has(startSeg)) continue;

    const path: Point[] = [startSeg.a];
    let current = startSeg;
    used.add(current);
    let iterations = 0;

    while (iterations++ < safetyLimit) {
      path.push(current.b);
      if (
        path[path.length - 1].x === startSeg.a.x &&
        path[path.length - 1].y === startSeg.a.y
      ) {
        path.pop(); // close implicitly
        break;
      }
      const candidates = byStart.get(keyOf(current.b));
      if (!candidates) break;
      const next = candidates.find((s) => !used.has(s));
      if (!next) break;
      used.add(next);
      current = next;
    }

    if (path.length >= 3) polygons.push(path);
  }

  return polygons;
}

/**
 * Drop consecutive collinear vertices so a long straight run becomes a
 * single edge with two endpoints.
 */
function simplifyCollinear(vertices: Point[]): Point[] {
  if (vertices.length < 3) return vertices;
  const out: Point[] = [];
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const prev = vertices[(i - 1 + n) % n];
    const cur = vertices[i];
    const next = vertices[(i + 1) % n];
    // Cross product of (cur-prev) and (next-cur). Zero → collinear.
    const cross =
      (cur.x - prev.x) * (next.y - cur.y) -
      (cur.y - prev.y) * (next.x - cur.x);
    if (cross !== 0) out.push(cur);
  }
  return out;
}

/**
 * Thickness (world-space px) of the axis-aligned corridor rects that
 * stitch diagonally-placed cluster members together. Sized to match
 * the visual weight of a panel's padded outline so a diagonal corridor
 * looks like a natural bracket — NOT like a thin pipe.
 */
const CLUSTER_CORRIDOR_THICKNESS = 64;

/**
 * Compute the minimum spanning tree of a set of panels using
 * center-to-center Euclidean distance. Prim's algorithm, O(N²) — fine
 * for the handful of panels that live in a typical cluster.
 *
 * Returns an array of index pairs, one per tree edge. Length = N − 1.
 */
function clusterMstEdges(panels: Panel[]): Array<[number, number]> {
  const n = panels.length;
  if (n < 2) return [];

  const cx = panels.map((p) => p.x + p.width / 2);
  const cy = panels.map((p) => p.y + p.height / 2);
  const dist = (i: number, j: number) =>
    Math.hypot(cx[i] - cx[j], cy[i] - cy[j]);

  const visited = new Array<boolean>(n).fill(false);
  const edges: Array<[number, number]> = [];
  visited[0] = true;

  for (let step = 1; step < n; step++) {
    let bestFrom = -1;
    let bestTo = -1;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      if (!visited[i]) continue;
      for (let j = 0; j < n; j++) {
        if (visited[j]) continue;
        const d = dist(i, j);
        if (d < bestD) {
          bestD = d;
          bestFrom = i;
          bestTo = j;
        }
      }
    }
    if (bestFrom === -1) break;
    edges.push([bestFrom, bestTo]);
    visited[bestTo] = true;
  }

  return edges;
}

/**
 * Build the corridor rect(s) that stitch two cluster members together
 * along the SHORTEST path between their bounding boxes. Three shapes,
 * picked by how the two panels sit relative to each other:
 *
 *   1. Axes overlap in both x AND y → panels already touch/overlap →
 *      no corridor needed.
 *
 *   2. Horizontally adjacent (y-ranges overlap, x-ranges don't) →
 *      single BAND filling the shared y-range, running from the right
 *      edge of the left panel to the left edge of the right panel.
 *      The band is as tall as the y-overlap, so a pair of same-height
 *      side-by-side panels get a full-height merge, not a thin pipe.
 *
 *   3. Vertically adjacent (x-ranges overlap, y-ranges don't) → same
 *      idea, vertical band filling the shared x-range.
 *
 *   4. Diagonal (neither axis overlaps) → L-shape of two fat rects
 *      anchored at the NEAREST corners of each panel (not centers).
 *      Thickness is `CLUSTER_CORRIDOR_THICKNESS` so it reads as a
 *      heavy bracket, not a thin pipe.
 */
function corridorRects(a: Panel, b: Panel): Rect[] {
  const ax0 = a.x;
  const ay0 = a.y;
  const ax1 = ax0 + a.width;
  const ay1 = ay0 + a.height;
  const bx0 = b.x;
  const by0 = b.y;
  const bx1 = bx0 + b.width;
  const by1 = by0 + b.height;

  // Axis-overlap intervals. Positive width = the panels share range.
  const xOverlapStart = Math.max(ax0, bx0);
  const xOverlapEnd = Math.min(ax1, bx1);
  const yOverlapStart = Math.max(ay0, by0);
  const yOverlapEnd = Math.min(ay1, by1);
  const hasXOverlap = xOverlapEnd > xOverlapStart;
  const hasYOverlap = yOverlapEnd > yOverlapStart;

  // Case 1: overlap on both axes → panels touch/intersect, nothing to bridge.
  if (hasXOverlap && hasYOverlap) return [];

  // Case 2: horizontally adjacent — single band filling the shared y-range.
  if (hasYOverlap) {
    const leftEdge = Math.min(ax1, bx1); // right edge of the left panel
    const rightEdge = Math.max(ax0, bx0); // left edge of the right panel
    if (leftEdge >= rightEdge) return []; // sanity (shouldn't happen here)
    return [
      {
        x: leftEdge,
        y: yOverlapStart,
        width: rightEdge - leftEdge,
        height: yOverlapEnd - yOverlapStart,
      },
    ];
  }

  // Case 3: vertically adjacent — single band filling the shared x-range.
  if (hasXOverlap) {
    const topEdge = Math.min(ay1, by1); // bottom edge of the top panel
    const bottomEdge = Math.max(ay0, by0); // top edge of the bottom panel
    if (topEdge >= bottomEdge) return [];
    return [
      {
        x: xOverlapStart,
        y: topEdge,
        width: xOverlapEnd - xOverlapStart,
        height: bottomEdge - topEdge,
      },
    ];
  }

  // Case 4: diagonal — no shared axis. Connect nearest corners.
  //   aOnLeft  → A is entirely to the left of B, so A's nearest-to-B
  //              corner is on A's right side.
  //   aOnTop   → A is entirely above B, so A's nearest corner is on
  //              A's bottom side.
  const aOnLeft = ax1 <= bx0;
  const aOnTop = ay1 <= by0;

  // Nearest corner of A to B, and nearest corner of B to A.
  const aCornerX = aOnLeft ? ax1 : ax0;
  const aCornerY = aOnTop ? ay1 : ay0;
  const bCornerX = aOnLeft ? bx0 : bx1;
  const bCornerY = aOnTop ? by0 : by1;

  const t = CLUSTER_CORRIDOR_THICKNESS;

  // Horizontal leg: from A's corner across to B's column.
  const hRect: Rect = {
    x: Math.min(aCornerX, bCornerX),
    y: aCornerY - t / 2,
    width: Math.abs(bCornerX - aCornerX),
    height: t,
  };
  // Vertical leg: from the elbow down/up to B's corner.
  const vRect: Rect = {
    x: bCornerX - t / 2,
    y: Math.min(aCornerY, bCornerY),
    width: t,
    height: Math.abs(bCornerY - aCornerY),
  };

  return [hRect, vRect];
}

/**
 * Compute the outline(s) of a padded cluster as one or more closed
 * rectilinear polygons in clockwise world-space order.
 *
 * For N >= 2 panels we ALSO add L-shaped connector rects along a
 * minimum spanning tree so the union is guaranteed to be a single
 * connected region — the dashed outline stays as one shape regardless
 * of how far a member is dragged, which matches cluster state (if the
 * panel is logically in the cluster, it's visually in the cluster).
 *
 * The multi-component tracer is retained as a safety net.
 *
 * Returns an empty array if the cluster has no panels.
 */
export function computeClusterOutline(
  panels: Panel[],
  padding = CLUSTER_PADDING
): Point[][] {
  if (panels.length === 0) return [];
  const rects = panels.map((p) => paddedPanelRect(p, padding));

  // Stitch every cluster member together with axis-aligned corridor
  // rects along a minimum spanning tree. This is what makes the outline
  // stay as a single connected shape even when panels are dragged far
  // apart inside the same cluster — and `corridorRects` picks the
  // shortest-distance connector shape for each pair (full-height band
  // when side-by-side, full-width band when stacked, thick L-bracket
  // only for true diagonal pairs).
  if (panels.length >= 2) {
    const mst = clusterMstEdges(panels);
    for (const [i, j] of mst) {
      rects.push(...corridorRects(panels[i], panels[j]));
    }
  }

  const grid = buildCellGrid(rects);
  const raw = traceOutlines(grid);
  return raw.map(simplifyCollinear).filter((p) => p.length >= 3);
}

/**
 * Build an SVG path `d` attribute that traces one or more polygons with
 * rounded corners of the given radius. Each polygon becomes a `M ... Z`
 * subpath so a single <path> element can render the entire multi-part
 * outline of a cluster whose members form disconnected groups.
 */
export function outlineToRoundedPath(
  polygons: Point[][],
  radius = CLUSTER_CORNER_RADIUS
): string {
  const subpaths = polygons
    .map((p) => polygonToRoundedSubpath(p, radius))
    .filter(Boolean);
  return subpaths.join(" ");
}

/** Render a single polygon as a rounded-corner SVG subpath. */
function polygonToRoundedSubpath(vertices: Point[], radius: number): string {
  const n = vertices.length;
  if (n < 3) return "";

  // Helper: clamp the corner radius per vertex so adjacent short edges
  // don't produce overlapping arcs. For each vertex we cap r at half the
  // length of the shorter adjacent edge.
  function radiusAt(i: number): number {
    const prev = vertices[(i - 1 + n) % n];
    const cur = vertices[i];
    const next = vertices[(i + 1) % n];
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y);
    return Math.max(0, Math.min(radius, Math.min(inLen, outLen) / 2));
  }

  // For each vertex compute the entry and exit points of the arc.
  const arcs: Array<{ in: Point; out: Point; r: number }> = [];
  for (let i = 0; i < n; i++) {
    const prev = vertices[(i - 1 + n) % n];
    const cur = vertices[i];
    const next = vertices[(i + 1) % n];
    const r = radiusAt(i);
    const vIn = { x: cur.x - prev.x, y: cur.y - prev.y };
    const vOut = { x: next.x - cur.x, y: next.y - cur.y };
    const inLen = Math.hypot(vIn.x, vIn.y) || 1;
    const outLen = Math.hypot(vOut.x, vOut.y) || 1;
    const inPoint = {
      x: cur.x - (vIn.x / inLen) * r,
      y: cur.y - (vIn.y / inLen) * r,
    };
    const outPoint = {
      x: cur.x + (vOut.x / outLen) * r,
      y: cur.y + (vOut.y / outLen) * r,
    };
    arcs.push({ in: inPoint, out: outPoint, r });
  }

  // Build the path: M (first entry), then L (next entry) A (arc to exit) ...
  // For a clockwise polygon, the arc sweep flag is 1 for convex corners
  // and 0 for concave. We detect convexity from the cross product sign.
  const cmds: string[] = [];
  cmds.push(`M ${arcs[0].out.x} ${arcs[0].out.y}`);
  for (let i = 1; i <= n; i++) {
    const idx = i % n;
    const arc = arcs[idx];
    // Line from previous arc's `out` point to this arc's `in` point.
    cmds.push(`L ${arc.in.x} ${arc.in.y}`);
    // Arc at this vertex: center is the original vertex, radius is arc.r.
    // Sweep direction depends on convexity.
    const prev = vertices[(idx - 1 + n) % n];
    const cur = vertices[idx];
    const next = vertices[(idx + 1) % n];
    const cross =
      (cur.x - prev.x) * (next.y - cur.y) -
      (cur.y - prev.y) * (next.x - cur.x);
    // Clockwise polygon: convex corners have cross > 0 → sweep = 1.
    //                    concave corners have cross < 0 → sweep = 0.
    const sweep = cross > 0 ? 1 : 0;
    cmds.push(
      `A ${arc.r} ${arc.r} 0 0 ${sweep} ${arc.out.x} ${arc.out.y}`
    );
  }
  cmds.push("Z");
  return cmds.join(" ");
}
