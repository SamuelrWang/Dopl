/**
 * Generic graph-drawing geometry — the substrate the ontology graph and
 * the workflow graph both render on. Nothing here knows about a domain:
 * a `SceneNode<T>` carries an opaque `data` payload and a free-form
 * `kind`; edge visual style is resolved by the caller (see EdgeLayer's
 * `styles` prop), so `SceneEdge.kind` is a plain string keyed into a
 * caller-supplied style map. Layout modules (ontology's column tree,
 * workflows' layered DAG) produce the `NodeLayout`/`SceneLayout` shapes
 * EdgeLayer consumes.
 */

export type EdgeSide = "top" | "right" | "bottom" | "left";

/** A world-space point. */
export interface Point {
  x: number;
  y: number;
}

/**
 * A persisted node position — the `{ x, y }` a user dragged a card to.
 * Stored server-side as a JSONB map keyed by node id (see the graph
 * `layout` columns); the hybrid resolver lets a stored position win over
 * the domain auto-layout per node.
 */
export type GraphLayout = Record<string, Point>;

/** A positioned card on the graph. `data` is domain payload (an ontology
 *  object, a workflow step, …); `kind` is a domain discriminator the
 *  renderer branches on. */
export interface SceneNode<T = unknown> {
  id: string;
  kind: string;
  data: T;
}

/** A directed connector. Routing hints (`fromSide`…`mid`) are filled by a
 *  layout module; `kind` selects the visual style from EdgeLayer's map.
 *  `points` is a fully-computed orthogonal polyline (from the shared
 *  `routeEdges` router) that EdgeLayer renders verbatim — when present it
 *  overrides the hint-based single-mid routing, so a route can have any
 *  number of elbows. Absent → EdgeLayer falls back to the hint geometry. */
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

/** A fully measured node box (adds the live height to a NodeLayout). */
export interface NodeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
