"use client";

import type { MockEdge, MockEdgeKind } from "../mock-data";

export interface NodeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Side = "top" | "right" | "bottom" | "left";

interface Point {
  x: number;
  y: number;
}

const NORMALS: Record<Side, Point> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

function sideAnchor(rect: NodeRect, side: Side): Point {
  switch (side) {
    case "top":
      return { x: rect.x + rect.width / 2, y: rect.y };
    case "bottom":
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height };
    case "left":
      return { x: rect.x, y: rect.y + rect.height / 2 };
    case "right":
      return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
  }
}

/** Facing sides picked by center delta — dominant axis wins. */
function facingSides(a: NodeRect, b: NodeRect): [Side, Side] {
  const dx = b.x + b.width / 2 - (a.x + a.width / 2);
  const dy = b.y + b.height / 2 - (a.y + a.height / 2);
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? ["right", "left"] : ["left", "right"];
  }
  return dy > 0 ? ["bottom", "top"] : ["top", "bottom"];
}

interface EdgeGeometry {
  d: string;
  mid: Point;
}

function edgeGeometry(a: NodeRect, b: NodeRect): EdgeGeometry {
  const [fromSide, toSide] = facingSides(a, b);
  const p0 = sideAnchor(a, fromSide);
  const p1 = sideAnchor(b, toSide);
  const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  const bend = Math.min(Math.max(dist * 0.35, 36), 130);
  const n0 = NORMALS[fromSide];
  const n1 = NORMALS[toSide];
  const c1 = { x: p0.x + n0.x * bend, y: p0.y + n0.y * bend };
  const c2 = { x: p1.x + n1.x * bend, y: p1.y + n1.y * bend };
  return {
    d: `M ${p0.x} ${p0.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p1.x} ${p1.y}`,
    // Cubic bezier point at t = 0.5.
    mid: {
      x: (p0.x + 3 * c1.x + 3 * c2.x + p1.x) / 8,
      y: (p0.y + 3 * c1.y + 3 * c2.y + p1.y) / 8,
    },
  };
}

const EDGE_STYLE: Record<
  MockEdgeKind,
  { stroke: string; dash?: string; width: number; marker?: string }
> = {
  containment: { stroke: "var(--border-highlight)", dash: "3 5", width: 1.5 },
  relationship: { stroke: "var(--text-secondary)", width: 1.5, marker: "url(#c2-arrow)" },
  ref: { stroke: "var(--text-muted)", dash: "1.5 4", width: 1.5, marker: "url(#c2-arrow-muted)" },
};

interface Props {
  edges: MockEdge[];
  rects: Record<string, NodeRect>;
  /** Edges touching this node render emphasized. */
  focusId: string | null;
}

/**
 * World-space SVG under the node cards: three visual classes of edge
 * (containment dashed, relationships solid + arrow + label pill, ref
 * attrs dotted). Label pills are HTML siblings so they use kit type
 * tokens instead of SVG text.
 */
export function EdgeLayer({ edges, rects, focusId }: Props) {
  const drawn = edges
    .map((edge) => {
      const from = rects[edge.from];
      const to = rects[edge.to];
      if (!from || !to) return null;
      return { edge, geometry: edgeGeometry(from, to) };
    })
    .filter((d): d is NonNullable<typeof d> => d !== null);

  return (
    <>
      <svg
        className="pointer-events-none absolute left-0 top-0 h-px w-px overflow-visible"
        aria-hidden
      >
        <defs>
          <marker
            id="c2-arrow"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0.5 0.8 L7 4 L0.5 7.2" fill="none" stroke="var(--text-secondary)" strokeWidth="1.4" />
          </marker>
          <marker
            id="c2-arrow-muted"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0.5 0.8 L7 4 L0.5 7.2" fill="none" stroke="var(--text-muted)" strokeWidth="1.4" />
          </marker>
        </defs>
        {drawn.map(({ edge, geometry }) => {
          const style = EDGE_STYLE[edge.kind];
          const focused =
            focusId !== null && (edge.from === focusId || edge.to === focusId);
          const dimmed = focusId !== null && !focused;
          return (
            <path
              key={edge.id}
              d={geometry.d}
              fill="none"
              stroke={style.stroke}
              strokeWidth={focused ? style.width + 0.5 : style.width}
              strokeDasharray={style.dash}
              markerEnd={style.marker}
              opacity={dimmed ? 0.35 : 1}
            />
          );
        })}
      </svg>
      {drawn.map(({ edge, geometry }) => {
        if (!edge.label) return null;
        const dimmed =
          focusId !== null && edge.from !== focusId && edge.to !== focusId;
        return (
          <span
            key={`${edge.id}-label`}
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-border-default bg-bg-elevated px-2 py-px text-micro font-medium text-text-secondary shadow-[0_1px_2px_rgba(0,0,0,0.05)]"
            style={{ left: geometry.mid.x, top: geometry.mid.y, opacity: dimmed ? 0.35 : 1 }}
          >
            {edge.label}
          </span>
        );
      })}
    </>
  );
}
