"use client";

import type { Point } from "@/shared/graph";
import { previewPoints } from "../graph/ports";
import { WORKFLOW_EDGE_STYLES } from "./workflow-edge-styles";

// A fresh connection lands as a plain sequence edge — match its stroke width
// so the rubber-band reads continuously into the edge the router draws.
const PREVIEW_STROKE = WORKFLOW_EDGE_STYLES.sequence.width;

/**
 * The rubber-band connector shown while a drag-to-connect is in flight: a
 * dashed orthogonal line from the source port to the live pointer, tipped
 * with a dot. Rendered in world space over the substrate (its own SVG at the
 * world origin, like EdgeLayer), so it lines up with the settled edge the
 * router draws once the connection lands. `active` colors the line when the
 * pointer is over a valid target.
 */
export function ConnectorPreview({
  origin,
  pointer,
  active,
}: {
  origin: Point;
  pointer: Point;
  active: boolean;
}) {
  const pts = previewPoints(origin, pointer);
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const stroke = active ? "var(--text-primary)" : "var(--text-secondary)";

  return (
    <svg
      className="pointer-events-none absolute left-0 top-0 z-30 h-px w-px overflow-visible"
      aria-hidden
    >
      <path d={d} fill="none" stroke={stroke} strokeWidth={PREVIEW_STROKE} strokeDasharray="5 4" />
      <circle cx={pointer.x} cy={pointer.y} r={3.5} fill={stroke} />
    </svg>
  );
}
