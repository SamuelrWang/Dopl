import type { EdgeSide, NodeLayout, SceneEdge, SceneLayout } from "@/shared/graph";
import type { OntologyObject } from "../types";

/** Generic graph geometry now lives in `@/shared/graph`; re-exported here
 *  so the ontology graph's local modules keep their short `./types`
 *  imports. */
export type { EdgeSide, NodeLayout, SceneEdge, SceneLayout };

export type SceneEdgeKind = "containment" | "relationship" | "ref";

/** The ontology's node payload: a column header or an object card, each
 *  backed by a live `OntologyObject` and tagged with the lane (column) it
 *  belongs to. */
export interface SceneNode {
  id: string;
  kind: "column" | "object";
  object: OntologyObject;
  columnId: string;
}

export interface Scene {
  nodes: SceneNode[];
  edges: SceneEdge[];
}
