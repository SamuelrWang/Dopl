interface Point {
  x: number;
  y: number;
}

/** Persisted node positions — server-side JSONB keyed by node id (graph
 *  `layout` columns). Stored wins over auto-layout per node. */
export type GraphLayout = Record<string, Point>;
