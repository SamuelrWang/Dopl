import type { GraphLayout, NodeLayout, NodeRect, Point } from "./types";

/**
 * Pure position helpers for the hybrid (auto + stored) layout model.
 * Deterministic, DOM-free.
 */

const NEW_NODE_PAD = 24;
const SCAN_STEP = 32;
const SCAN_COLUMN_ROWS = 12;
const SCAN_MAX_TRIES = 240;

/** Effective positions: stored (dragged) wins per node, else auto. Width
 *  always from auto — persistence only stores x/y. Stored ids absent from
 *  `auto` ignored: a deleted node can't resurrect a lane. */
export function resolvePositions(
  auto: Record<string, NodeLayout>,
  stored?: GraphLayout | null
): Record<string, NodeLayout> {
  if (!stored) return { ...auto };
  const out: Record<string, NodeLayout> = {};
  for (const [id, pos] of Object.entries(auto)) {
    const override = stored[id];
    out[id] =
      override && Number.isFinite(override.x) && Number.isFinite(override.y)
        ? { x: override.x, y: override.y, width: pos.width }
        : pos;
  }
  return out;
}

/** Drop stored entries whose node left the auto layout. Keeps the blob
 *  orphan-free and Reset-layout unlit for a deleted node. */
export function pruneLayout(
  layout: GraphLayout,
  auto: Record<string, NodeLayout>
): GraphLayout {
  const out: GraphLayout = {};
  for (const [id, pos] of Object.entries(layout)) {
    if (auto[id]) out[id] = pos;
  }
  return out;
}

/**
 * ⚠ Merge-except-empty, defined once for the ontology repository. Empty patch
 * = reset signal → REPLACES with `{}`. Any other patch SHALLOW-MERGES per
 * node id: the `layout` column is one blob, so a partial write must fold in
 * untouched nodes here or two tabs dragging different cards clobber.
 */
export function mergeStoredLayout(
  current: GraphLayout | null | undefined,
  patch: GraphLayout
): GraphLayout {
  if (Object.keys(patch).length === 0) return {};
  return { ...(current ?? {}), ...patch };
}

function overlaps(a: NodeRect, b: NodeRect, pad: number): boolean {
  return (
    a.x - pad < b.x + b.width &&
    a.x + a.width + pad > b.x &&
    a.y - pad < b.y + b.height &&
    a.y + a.height + pad > b.y
  );
}

/** Free spot for a new card near centre-right, scanning down then into a
 *  fresh column. `viewport` (visible scroll rect, world coords) anchors the
 *  search; without it, lands right of everything placed. */
export function placeNewNode(
  existing: NodeRect[],
  size: { width: number; height: number },
  viewport?: { x: number; y: number; width: number; height: number }
): Point {
  let baseX: number;
  let baseY: number;
  if (viewport) {
    baseX = viewport.x + viewport.width * 0.58;
    baseY = viewport.y + viewport.height * 0.36;
  } else if (existing.length > 0) {
    baseX = Math.max(...existing.map((r) => r.x + r.width)) + 48;
    baseY = Math.min(...existing.map((r) => r.y));
  } else {
    baseX = 120;
    baseY = 80;
  }

  const candidate: Point = { x: Math.max(0, baseX), y: Math.max(0, baseY) };
  for (let i = 0; i < SCAN_MAX_TRIES; i++) {
    const rect: NodeRect = {
      x: candidate.x,
      y: candidate.y,
      width: size.width,
      height: size.height,
    };
    if (!existing.some((r) => overlaps(rect, r, NEW_NODE_PAD))) return candidate;
    candidate.y += SCAN_STEP;
    if (candidate.y > baseY + SCAN_COLUMN_ROWS * SCAN_STEP) {
      candidate.y = Math.max(0, baseY);
      candidate.x += size.width + 48;
    }
  }
  return candidate;
}

/** World size containing every rect + padding, floored at `min`. */
export function worldBounds(
  rects: NodeRect[],
  padding: number,
  min: { width: number; height: number }
): { width: number; height: number } {
  let maxRight = 0;
  let maxBottom = 0;
  for (const r of rects) {
    maxRight = Math.max(maxRight, r.x + r.width);
    maxBottom = Math.max(maxBottom, r.y + r.height);
  }
  return {
    width: Math.max(min.width, maxRight + padding),
    height: Math.max(min.height, maxBottom + padding),
  };
}
