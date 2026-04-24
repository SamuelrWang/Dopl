/**
 * Cluster auto-layout — when the user clicks "Cluster" in the selection
 * menu, we reorganize the selected panels into a compact grid before the
 * outline is drawn. This matches the user's explicit request:
 *
 *   "When the user clicks the cluster button, have it so that the canvas
 *    is reorganized so that those clustered items are placed together,
 *    basically next to each other."
 *
 * Algorithm:
 *   1. Keep the selection's current reading order (top-then-left) so
 *      the user's mental map of "which panel is which" is preserved.
 *   2. Place panels into ceil(sqrt(n)) columns with `CLUSTER_LAYOUT_GAP`
 *      between them.
 *   3. Each row's height is the max height of panels in that row, so
 *      variable-height panels don't overlap.
 *   4. Anchor the grid at the top-left of the selection's current
 *      bounding box, so the cluster appears where the user was working.
 *
 * Output: `Array<{ id, x, y }>` — absolute positions for every panel,
 * consumed directly by the `CREATE_CLUSTER` reducer action.
 */

import type { Panel } from "../types";
import { panelsBoundingBox } from "./cluster-geometry";

/** World-space gap between adjacent panels inside a cluster. */
export const CLUSTER_LAYOUT_GAP = 32;

export interface PanelMove {
  id: string;
  x: number;
  y: number;
}

/**
 * Compute new positions for the given panels so they sit in a compact
 * grid at the top-left of their current bounding box. Returns one entry
 * per input panel.
 */
export function computeClusterLayout(panels: Panel[]): PanelMove[] {
  if (panels.length === 0) return [];

  // Stable reading-order sort (top → bottom, ties left → right).
  const ordered = [...panels].sort((a, b) => {
    if (a.y !== b.y) return a.y - b.y;
    return a.x - b.x;
  });

  // Anchor the grid at the current bounding box top-left so the cluster
  // materialises near where the user was interacting.
  const bbox = panelsBoundingBox(panels);
  const anchorX = bbox.x;
  const anchorY = bbox.y;

  // Grid shape: roughly square by panel COUNT.
  const cols = Math.max(1, Math.ceil(Math.sqrt(ordered.length)));

  const moves: PanelMove[] = [];
  let cursorX = anchorX;
  let cursorY = anchorY;
  let rowMaxHeight = 0;

  for (let i = 0; i < ordered.length; i++) {
    const col = i % cols;
    if (col === 0 && i > 0) {
      // New row — advance cursor by the tallest panel in the previous row.
      cursorX = anchorX;
      cursorY += rowMaxHeight + CLUSTER_LAYOUT_GAP;
      rowMaxHeight = 0;
    }
    const p = ordered[i];
    moves.push({ id: p.id, x: Math.round(cursorX), y: Math.round(cursorY) });
    cursorX += p.width + CLUSTER_LAYOUT_GAP;
    if (p.height > rowMaxHeight) rowMaxHeight = p.height;
  }

  return moves;
}
