"use client";

/**
 * EdgeLayer — renders committed workflow edges in WORLD space.
 *
 * One zero-size SVG at the world origin with overflow visible; each edge
 * is a cubic bezier from the source panel's right-center (out port) to
 * the target panel's left-center (in port). Coordinates are plain world
 * coords, so the world div's camera transform handles pan/zoom for free.
 *
 * Edges re-render with panel moves because the parent passes `panels`
 * (position-bearing) as a prop. Clicking an edge removes it (the path
 * has a generous invisible hit-stroke).
 */

import { useCanvas, useCapabilities } from "../canvas-store";
import type { Edge, Panel } from "../types";

export function EdgeLayer({ panels, edges }: { panels: Panel[]; edges: Edge[] }) {
  const { dispatch } = useCanvas();
  const { canMove } = useCapabilities();
  if (edges.length === 0) return null;

  const byId = new Map(panels.map((p) => [p.id, p]));

  return (
    <svg
      className="absolute"
      style={{
        left: 0,
        top: 0,
        width: 0,
        height: 0,
        overflow: "visible",
        pointerEvents: "none",
      }}
      aria-hidden
    >
      {edges.map((edge) => {
        const from = byId.get(edge.fromPanelId);
        const to = byId.get(edge.toPanelId);
        if (!from || !to) return null;
        const x1 = from.x + from.width;
        const y1 = from.y + from.height / 2;
        const x2 = to.x;
        const y2 = to.y + to.height / 2;
        const bend = Math.max(48, Math.abs(x2 - x1) / 2);
        const d = `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
        return (
          <g key={edge.id}>
            <path
              d={d}
              fill="none"
              stroke="#5b82b0"
              strokeWidth={2}
              strokeLinecap="round"
            />
            {/* Invisible fat hit-area for click-to-remove (editors only). */}
            {canMove ? (
              <path
                d={d}
                fill="none"
                stroke="transparent"
                strokeWidth={14}
                style={{ pointerEvents: "stroke", cursor: "pointer" }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  dispatch({ type: "EDGE_REMOVE", edgeId: edge.id });
                }}
              >
                <title>Remove connection</title>
              </path>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
