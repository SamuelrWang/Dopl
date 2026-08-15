/**
 * Generic graph-drawing geometry. Domain-agnostic: `SceneNode<T>` carries an
 * opaque `data` + free-form `kind`; `SceneEdge.kind` keys into a
 * caller-supplied style map (EdgeLayer's `styles` prop). Domain layout
 * modules produce the `NodeLayout`/`SceneLayout` shapes EdgeLayer consumes.
 */

export type EdgeSide = "top" | "right" | "bottom" | "left";

export interface Point {
  x: number;
  y: number;
}

/** Persisted node positions — server-side JSONB keyed by node id (graph
 *  `layout` columns). Stored wins over auto-layout per node. */
export type GraphLayout = Record<string, Point>;

/** Positioned card. `data` = domain payload; `kind` = domain discriminator
 *  the renderer branches on. */
export interface SceneNode<T = unknown> {
  id: string;
  kind: string;
  data: T;
}

/** Directed connector. Hints (`fromSide`…`mid`) filled by a layout module;
 *  `kind` selects style from EdgeLayer's map. `points` = polyline from
 *  `routeEdges`, rendered verbatim; present → overrides the single-mid hint
 *  geometry (any number of elbows), absent → EdgeLayer falls back to it. */
export interface SceneEdge {
  id: string;
  kind: string;
  from: string;
  to: string;
  label?: string;
  fromSide?: EdgeSide;
  toSide?: EdgeSide;
  fromT?: number;
  toT?: number;
  mid?: number;
  points?: Point[];
}

/** Top-left corner + width of a node; height is measured live by the view. */
export interface NodeLayout {
  x: number;
  y: number;
  width: number;
}

export interface SceneLayout {
  positions: Record<string, NodeLayout>;
  worldWidth: number;
  worldHeight: number;
}

/** NodeLayout + the live measured height. */
export interface NodeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
