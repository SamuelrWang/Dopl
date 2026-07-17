import type { NodeRect, Point } from "@/shared/graph";

/**
 * Pure geometry for the workflow graph's drag-to-connect ports — the
 * reducer-y parts of `use-connect-drag`, extracted so they test without a
 * DOM. Covers the world-space anchor of a port on a node's edge, hit-testing
 * the card under the pointer while dragging a connector, the rubber-band
 * preview polyline, and the client→world coordinate mapping inside the
 * scrollable substrate. All deterministic and DOM-free.
 */

/** A connectable side of a step card. `right` is the output handle a
 *  connect-drag starts from; `left` is the input a connector lands on. */
export type PortSide = "left" | "right";

/** World-space anchor of a port on a node's edge (vertically centered). */
export function portAnchor(rect: NodeRect, side: PortSide): Point {
  return {
    x: side === "right" ? rect.x + rect.width : rect.x,
    y: rect.y + rect.height / 2,
  };
}

/**
 * The id of the node whose rect contains `point`, excluding `excludeId`
 * (the connect-drag's own source), or null when the pointer is over empty
 * substrate. When rects overlap, the last one in iteration order wins —
 * matching the paint order, so the visually-topmost card is the target.
 */
export function hitTestNode(
  point: Point,
  rects: Record<string, NodeRect>,
  excludeId?: string
): string | null {
  let found: string | null = null;
  for (const [id, r] of Object.entries(rects)) {
    if (id === excludeId) continue;
    if (
      point.x >= r.x &&
      point.x <= r.x + r.width &&
      point.y >= r.y &&
      point.y <= r.y + r.height
    ) {
      found = id;
    }
  }
  return found;
}

/**
 * Orthogonal rubber-band polyline from an output port to the live pointer.
 * Horizontal-first (the connector exits the card's left/right edge), turning
 * at the midpoint — the same elbow family the shared router draws for a
 * settled H edge, so the preview reads continuously into the final edge.
 */
export function previewPoints(source: Point, pointer: Point): Point[] {
  const midX = (source.x + pointer.x) / 2;
  return [source, { x: midX, y: source.y }, { x: midX, y: pointer.y }, pointer];
}

/** A scroll container's live geometry, as read from the DOM by the caller. */
export interface ContainerFrame {
  left: number;
  top: number;
  scrollLeft: number;
  scrollTop: number;
}

/** Map a client (viewport) point to world coords inside the substrate — the
 *  substrate sits at world origin within the scroll container, so world =
 *  client − containerOrigin + scroll. */
export function clientToWorld(
  clientX: number,
  clientY: number,
  frame: ContainerFrame
): Point {
  return {
    x: clientX - frame.left + frame.scrollLeft,
    y: clientY - frame.top + frame.scrollTop,
  };
}
