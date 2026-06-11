"use client";

/**
 * EdgeLayer — renders committed workflow edges in WORLD space.
 *
 * One SVG at the world origin with overflow visible; each edge curves
 * from the source panel's facing side to the target panel's facing side
 * (facingAnchors picks the sides). Coordinates are plain world coords, so
 * the world div's camera transform handles pan/zoom for free.
 *
 * Style: dashed line with a continuous stream of `>` chevrons traveling
 * source → target along the path (SVG animateMotion over the edge's own
 * geometry). Chevron count scales with the edge's length so the spacing
 * stays uniform — longer lines carry more arrows. No static arrowhead;
 * the moving stream is the direction cue.
 *
 * Edges re-render with panel moves because the parent passes `panels`
 * (position-bearing) as a prop. Clicking an edge removes it (the path has
 * a generous invisible hit-stroke).
 */

import { useCanvas, useCapabilities } from "../canvas-store";
import { edgePath, facingAnchors, sideNormal } from "./anchors";
import type { Edge, Panel } from "../types";

const STROKE = "#5b82b0";
/** Traveling `>` glyph, drawn centered on the origin so the motion
 *  transform's rotation pivots through its middle. Sized to match the
 *  old fixed arrowhead (~8px span). */
const CHEVRON = "M-4 -4 L4 0 L-4 4";
/** Target world-px between traveling chevrons — count scales with length. */
const CHEVRON_SPACING = 80;
/** Travel speed in world px/s — constant across edges so short and long
 *  lines flow at the same pace. */
const CHEVRON_SPEED = 70;

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
        // NOT 0×0: zero-sized SVGs can be skipped by the compositor
        // entirely (overflow:visible notwithstanding), which renders the
        // committed edges invisible. A 1px box with visible overflow
        // paints reliably.
        width: 1,
        height: 1,
        overflow: "visible",
        pointerEvents: "none",
      }}
      aria-hidden
    >
      {edges.map((edge) => {
        const from = byId.get(edge.fromPanelId);
        const to = byId.get(edge.toPanelId);
        if (!from || !to) return null;
        const a = facingAnchors(from, to);
        // Pull the target end ~9px out along the side normal so the
        // stream finishes just outside the connector dot instead of
        // disappearing underneath it.
        const tn = sideNormal(a.toSide);
        const x2 = a.x2 + tn.nx * 9;
        const y2 = a.y2 + tn.ny * 9;
        const d = edgePath({ ...a, x2, y2 });
        const pathId = `edge-path-${edge.id}`;
        // Chevron stream sizing: count from chord length (good enough for
        // these gentle curves) so spacing stays ~uniform; duration from a
        // constant speed so every edge flows at the same pace. Negative
        // `begin` offsets phase the loop — with paced timing that spreads
        // the glyphs evenly ALONG the path, continuously.
        const length = Math.hypot(x2 - a.x1, y2 - a.y1);
        const count = Math.max(1, Math.round(length / CHEVRON_SPACING));
        const dur = Math.max(length / CHEVRON_SPEED, 0.8);
        return (
          <g key={edge.id}>
            <path
              id={pathId}
              d={d}
              fill="none"
              stroke={STROKE}
              strokeWidth={2}
              strokeLinecap="round"
              strokeDasharray="6 4"
            />
            {Array.from({ length: count }, (_, i) => (
              <path
                key={i}
                d={CHEVRON}
                fill="none"
                stroke={STROKE}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <animateMotion
                  dur={`${dur}s`}
                  begin={`${-(i / count) * dur}s`}
                  repeatCount="indefinite"
                  rotate="auto"
                  // Paced = constant velocity along the path, which is what
                  // keeps the phase offsets evenly SPACED, not just evenly
                  // timed.
                  calcMode="paced"
                >
                  <mpath href={`#${pathId}`} />
                </animateMotion>
              </path>
            ))}
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
