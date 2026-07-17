import type { GraphLayout, NodeLayout, NodeRect, Point } from "./types";

/**
 * Pure position helpers for the hybrid (auto + stored) layout model. The
 * domain layout fn produces `auto` positions; a user's dragged positions
 * live in `stored`. `resolvePositions` merges them (stored wins per node,
 * auto fills the rest); `placeNewNode` finds a free spot for a just-created
 * card; `worldBounds` sizes the scroll world around whatever positions
 * ended up effective. All deterministic and DOM-free.
 */

const NEW_NODE_PAD = 24;
const SCAN_STEP = 32;
const SCAN_COLUMN_ROWS = 12;
const SCAN_MAX_TRIES = 240;

/**
 * Effective positions: for every node the domain auto-layout placed, a
 * stored (dragged) position wins if present, otherwise the auto position
 * stands. Width always comes from auto (persistence only stores x/y).
 * Stored entries for nodes no longer in `auto` are ignored — a deleted
 * node can't resurrect a lane.
 */
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

/**
 * Drop stored (dragged) entries whose node is no longer in the auto layout —
 * a deleted node's position is dead data. Used to keep the persisted layout
 * from accumulating orphans, and to keep the "layout dirtied" signal honest
 * (a deleted node shouldn't light up the Reset-layout button).
 */
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
 * Fold a layout patch into the stored layout for a server-side persist. An
 * empty patch is the reset signal → REPLACES with `{}`. Any other patch
 * SHALLOW-MERGES per node id over the current layout, so two tabs each
 * dragging a different card don't clobber each other (the `layout` column is
 * one blob, so a partial write must fold in the untouched nodes here). Shared
 * by the ontology repository + workflows service so the merge-except-empty
 * semantic is defined once.
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

/**
 * A free spot for a new card near the visual centre-right — where the eye
 * expects the "next" node — scanning down then into a fresh column until it
 * clears every existing rect. `viewport` (visible scroll rect in world
 * coords) anchors the search when supplied; otherwise it lands to the right
 * of everything already placed.
 */
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

/** World size that contains every rect plus padding, floored at a minimum. */
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
