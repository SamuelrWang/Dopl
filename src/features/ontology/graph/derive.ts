import type { GraphState } from "../graph-state";
import type { Scene, SceneEdge, SceneNode } from "./types";

export function deriveScene(graph: GraphState, clusterId: string): Scene {
  const cluster = graph.clusters.find((c) => c.id === clusterId);
  if (!cluster) return { nodes: [], edges: [] };

  const nodes: SceneNode[] = [];
  const visited = new Set<string>();

  const walk = (id: string, columnId: string, isRoot: boolean): void => {
    if (visited.has(id)) return;
    const object = graph.objects[id];
    if (!object) return;
    visited.add(id);
    nodes.push({ id, kind: isRoot ? "column" : "object", object, columnId });
    for (const childId of object.childIds) {
      walk(childId, columnId, false);
    }
  };

  for (const columnId of cluster.columnIds) {
    walk(columnId, columnId, true);
  }

  const inScene = new Set(nodes.map((n) => n.id));
  const containment: SceneEdge[] = [];
  const relationships: SceneEdge[] = [];
  const refs: SceneEdge[] = [];

  for (const node of nodes) {
    const from = node.id;
    const { childIds, relationships: rels, attributes } = node.object;

    for (const to of childIds) {
      if (to === from || !inScene.has(to)) continue;
      containment.push({ id: `c:${from}:${to}`, kind: "containment", from, to });
    }

    for (const rel of rels) {
      for (const to of rel.targetIds) {
        if (to === from || !inScene.has(to)) continue;
        relationships.push({
          id: `r:${from}:${rel.label}:${to}`,
          kind: "relationship",
          from,
          to,
          label: rel.label,
        });
      }
    }

    for (const attr of attributes) {
      if (attr.value.kind !== "ref") continue;
      for (const to of attr.value.value) {
        if (to === from || !inScene.has(to)) continue;
        refs.push({
          id: `f:${from}:${attr.key}:${to}`,
          kind: "ref",
          from,
          to,
          label: attr.label,
        });
      }
    }
  }

  return { nodes, edges: [...containment, ...relationships, ...refs] };
}
