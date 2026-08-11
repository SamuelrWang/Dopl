"use client";

import type { ReactNode } from "react";
import { labelAnchor } from "./route-edges";
import type { EdgeSide, NodeRect, Point, SceneEdge } from "./types";

/** Visual style for one edge kind — resolved by the caller and keyed by
 *  `SceneEdge.kind`. `marker` is a `url(#id)` referencing a def the caller
 *  supplies via the `markers` prop. */
export interface EdgeStyle {
  stroke: string;
  dash?: string;
  width: number;
  marker?: string;
}

const CORNER_RADIUS = 14;

function sideAnchor(rect: NodeRect, side: EdgeSide, t: number): Point {
  switch (side) {
    case "top":
      return { x: rect.x + rect.width * t, y: rect.y };
    case "bottom":
      return { x: rect.x + rect.width * t, y: rect.y + rect.height };
    case "left":
      return { x: rect.x, y: rect.y + rect.height * t };
    case "right":
      return { x: rect.x + rect.width, y: rect.y + rect.height * t };
  }
}

function isHorizontalExit(side: EdgeSide): boolean {
  return side === "left" || side === "right";
}

/** Fallback sides when an edge carries no routing hints: dominant axis. */
function inferSides(a: NodeRect, b: NodeRect): [EdgeSide, EdgeSide] {
  const dx = b.x + b.width / 2 - (a.x + a.width / 2);
  const dy = b.y + b.height / 2 - (a.y + a.height / 2);
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? ["right", "left"] : ["left", "right"];
  }
  return dy > 0 ? ["bottom", "top"] : ["top", "bottom"];
}

/**
 * Orthogonal waypoints for one edge — straight H/V segments only.
 *  - opposite vertical sides  → H-V-H through `mid` x
 *  - same vertical side       → loop out to `mid` x
 *  - opposite horizontal      → V-H-V through `mid` y
 *  - same horizontal side     → loop out to `mid` y
 *  - mixed axes               → single L corner
 */
function routePoints(a: NodeRect, b: NodeRect, edge: SceneEdge): Point[] {
  const [inferredFrom, inferredTo] = inferSides(a, b);
  const fromSide = edge.fromSide ?? inferredFrom;
  const toSide = edge.toSide ?? inferredTo;
  const p0 = sideAnchor(a, fromSide, edge.fromT ?? 0.5);
  const p1 = sideAnchor(b, toSide, edge.toT ?? 0.5);
  const fromH = isHorizontalExit(fromSide);
  const toH = isHorizontalExit(toSide);

  if (fromH && toH) {
    if (fromSide === toSide) {
      const out =
        edge.mid ?? (fromSide === "left" ? Math.min(p0.x, p1.x) - 48 : Math.max(p0.x, p1.x) + 48);
      return [p0, { x: out, y: p0.y }, { x: out, y: p1.y }, p1];
    }
    const midX = edge.mid ?? (p0.x + p1.x) / 2;
    return [p0, { x: midX, y: p0.y }, { x: midX, y: p1.y }, p1];
  }
  if (!fromH && !toH) {
    if (fromSide === toSide) {
      const out =
        edge.mid ?? (fromSide === "top" ? Math.min(p0.y, p1.y) - 48 : Math.max(p0.y, p1.y) + 48);
      return [p0, { x: p0.x, y: out }, { x: p1.x, y: out }, p1];
    }
    const midY = edge.mid ?? (p0.y + p1.y) / 2;
    return [p0, { x: p0.x, y: midY }, { x: p1.x, y: midY }, p1];
  }
  // Mixed axes: one corner, placed on the exit axis of the source.
  return fromH ? [p0, { x: p1.x, y: p0.y }, p1] : [p0, { x: p0.x, y: p1.y }, p1];
}

/** Drop zero-length and collinear intermediate points. */
function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (prev && prev.x === p.x && prev.y === p.y) continue;
    out.push(p);
  }
  return out.filter((p, i) => {
    if (i === 0 || i === out.length - 1) return true;
    const a = out[i - 1];
    const b = out[i + 1];
    return !((a.x === p.x && p.x === b.x) || (a.y === p.y && p.y === b.y));
  });
}

/** Polyline → SVG path with rounded corners (quadratic joins). */
function roundedPath(points: Point[]): string {
  if (points.length < 2) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const corner = points[i];
    const next = points[i + 1];
    const lenIn = Math.hypot(corner.x - prev.x, corner.y - prev.y);
    const lenOut = Math.hypot(next.x - corner.x, next.y - corner.y);
    const r = Math.min(CORNER_RADIUS, lenIn / 2, lenOut / 2);
    const inDir = { x: (corner.x - prev.x) / (lenIn || 1), y: (corner.y - prev.y) / (lenIn || 1) };
    const outDir = { x: (next.x - corner.x) / (lenOut || 1), y: (next.y - corner.y) / (lenOut || 1) };
    d += ` L ${corner.x - inDir.x * r} ${corner.y - inDir.y * r}`;
    d += ` Q ${corner.x} ${corner.y} ${corner.x + outDir.x * r} ${corner.y + outDir.y * r}`;
  }
  const last = points[points.length - 1];
  return `${d} L ${last.x} ${last.y}`;
}

interface Props {
  edges: SceneEdge[];
  rects: Record<string, NodeRect>;
  /** Edges touching this node render emphasized; the rest dim. */
  focusId: string | null;
  /** Visual style per `SceneEdge.kind`. */
  styles: Record<string, EdgeStyle>;
  /** Style for a kind absent from `styles`. */
  defaultStyle?: EdgeStyle;
  /** SVG `<marker>` defs (arrowheads) referenced by `EdgeStyle.marker`. */
  markers?: ReactNode;
}

const FALLBACK_STYLE: EdgeStyle = { stroke: "var(--text-muted)", width: 1.5 };

/**
 * World-space SVG under the node cards. Orthogonal edges (straight
 * segments, rounded elbows) styled per kind by the caller-supplied
 * `styles` map; label pills are HTML siblings so they pick up the kit
 * type tokens. Domain-agnostic: the ontology graph and any future
 * graph pass their own styles + markers.
 */
export function EdgeLayer({ edges, rects, focusId, styles, defaultStyle, markers }: Props) {
  const drawn = edges
    .map((edge) => {
      // A router-supplied polyline wins; otherwise fall back to the
      // hint-based single-mid geometry (needs both rects).
      let points: Point[] | null = null;
      if (edge.points && edge.points.length >= 2) {
        points = simplify(edge.points);
      } else {
        const from = rects[edge.from];
        const to = rects[edge.to];
        if (from && to) points = simplify(routePoints(from, to, edge));
      }
      if (!points || points.length < 2) return null;
      return { edge, d: roundedPath(points), mid: labelAnchor(points) };
    })
    .filter((d): d is NonNullable<typeof d> => d !== null);

  return (
    <>
      <svg
        className="pointer-events-none absolute left-0 top-0 h-px w-px overflow-visible"
        aria-hidden
      >
        {markers && <defs>{markers}</defs>}
        {drawn.map(({ edge, d }) => {
          const style = styles[edge.kind] ?? defaultStyle ?? FALLBACK_STYLE;
          const focused =
            focusId !== null && (edge.from === focusId || edge.to === focusId);
          const dimmed = focusId !== null && !focused;
          return (
            <path
              key={edge.id}
              d={d}
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
      {drawn.map(({ edge, mid }) => {
        if (!edge.label) return null;
        const dimmed =
          focusId !== null && edge.from !== focusId && edge.to !== focusId;
        return (
          <span
            key={`${edge.id}-label`}
            title={edge.label}
            className="pointer-events-none absolute z-10 block max-w-[200px] -translate-x-1/2 -translate-y-1/2 truncate rounded-full border border-border-default bg-bg-elevated px-2 py-px text-micro font-medium text-text-secondary shadow-[0_1px_2px_rgba(0,0,0,0.05)]"
            style={{ left: mid.x, top: mid.y, opacity: dimmed ? 0.35 : 1 }}
          >
            {edge.label}
          </span>
        );
      })}
    </>
  );
}
