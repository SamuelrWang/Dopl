import type { OntologyObject } from "../types";

export type EdgeSide = "top" | "right" | "bottom" | "left";

export type SceneEdgeKind = "containment" | "relationship" | "ref";

export interface SceneNode {
  id: string;
  kind: "column" | "object";
  object: OntologyObject;
  columnId: string;
}

export interface SceneEdge {
  id: string;
  kind: SceneEdgeKind;
  from: string;
  to: string;
  label?: string;
  fromSide?: EdgeSide;
  toSide?: EdgeSide;
  fromT?: number;
  toT?: number;
  mid?: number;
}

export interface Scene {
  nodes: SceneNode[];
  edges: SceneEdge[];
}

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
