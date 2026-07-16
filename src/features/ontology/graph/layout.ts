import type { NodeLayout, Scene, SceneEdge, SceneLayout, SceneNode } from "./types";

const COLUMN_WIDTH = 240;
export const OBJECT_WIDTH = 280;
export const MARGIN = 150;
export const LANE_PITCH = 630;
export const TOP_Y = 80;
export const DEFAULT_HEIGHT = 180;
export const VGAP_FIRST = 70;
export const VGAP = 60;
const WORLD_PADDING = 150;
export const MIN_WORLD_WIDTH = 1200;
export const MIN_WORLD_HEIGHT = 800;

const OBJECT_INSET = (COLUMN_WIDTH - OBJECT_WIDTH) / 2;
const LOOP_INSET = 60;
const REF_LANE_INSET = 60;
const STAGGER = 20;
const T_CYCLE = [0.3, 0.5, 0.7] as const;

function heightOf(id: string, heights: Record<string, number>): number {
  return heights[id] ?? DEFAULT_HEIGHT;
}

function gapCenter(gapIndex: number): number {
  return MARGIN + gapIndex * LANE_PITCH + (COLUMN_WIDTH + LANE_PITCH) / 2;
}

// 0, +20, -20, +40, -40, … — keeps parallel edges near the gap centre while
// guaranteeing each successive edge sits on its own lane.
function staggerOffset(k: number): number {
  if (k === 0) return 0;
  const magnitude = Math.ceil(k / 2) * STAGGER;
  return k % 2 === 1 ? magnitude : -magnitude;
}

export function layoutScene(scene: Scene, heights: Record<string, number>): SceneLayout {
  const positions: Record<string, NodeLayout> = {};
  const columnNodes = scene.nodes.filter((n) => n.kind === "column");

  columnNodes.forEach((columnNode, lane) => {
    const columnX = MARGIN + lane * LANE_PITCH;
    positions[columnNode.id] = { x: columnX, y: TOP_Y, width: COLUMN_WIDTH };

    const objectX = columnX + OBJECT_INSET;
    let nextY = TOP_Y + heightOf(columnNode.id, heights) + VGAP_FIRST;
    for (const node of scene.nodes) {
      if (node.kind !== "object" || node.columnId !== columnNode.id) continue;
      positions[node.id] = { x: objectX, y: nextY, width: OBJECT_WIDTH };
      nextY += heightOf(node.id, heights) + VGAP;
    }
  });

  let maxRight = 0;
  let maxBottom = 0;
  for (const node of scene.nodes) {
    const pos = positions[node.id];
    if (!pos) continue;
    maxRight = Math.max(maxRight, pos.x + pos.width);
    maxBottom = Math.max(maxBottom, pos.y + heightOf(node.id, heights));
  }

  return {
    positions,
    worldWidth: Math.max(MIN_WORLD_WIDTH, maxRight + WORLD_PADDING),
    worldHeight: Math.max(MIN_WORLD_HEIGHT, maxBottom + WORLD_PADDING),
  };
}

function firstInSceneChild(
  parent: SceneNode | undefined,
  positions: Record<string, NodeLayout>,
): string | null {
  if (!parent) return null;
  for (const childId of parent.object.childIds) {
    if (positions[childId]) return childId;
  }
  return null;
}

function routeContainment(
  edge: SceneEdge,
  nodeById: Map<string, SceneNode>,
  layout: SceneLayout,
): SceneEdge {
  const isFirst = firstInSceneChild(nodeById.get(edge.from), layout.positions) === edge.to;
  if (isFirst) {
    return { ...edge, fromSide: "bottom", toSide: "top" };
  }
  const childPos = layout.positions[edge.to];
  const mid = childPos ? childPos.x - LOOP_INSET : undefined;
  return { ...edge, fromSide: "left", toSide: "left", mid };
}

function routeRelationship(
  edge: SceneEdge,
  layout: SceneLayout,
  laneOf: (id: string) => number,
  gapCounters: Map<number, number>,
): SceneEdge {
  const fromLane = laneOf(edge.from);
  const toLane = laneOf(edge.to);
  const fromPos = layout.positions[edge.from];
  const toPos = layout.positions[edge.to];

  if (fromLane === toLane) {
    const goingDown = !fromPos || !toPos || toPos.y >= fromPos.y;
    return goingDown
      ? { ...edge, fromSide: "bottom", toSide: "top" }
      : { ...edge, fromSide: "top", toSide: "bottom" };
  }

  const goingRight = toLane > fromLane;
  const gapIndex = goingRight ? fromLane : fromLane - 1;
  const k = gapCounters.get(gapIndex) ?? 0;
  gapCounters.set(gapIndex, k + 1);

  return {
    ...edge,
    fromSide: goingRight ? "right" : "left",
    toSide: goingRight ? "left" : "right",
    fromT: T_CYCLE[k % T_CYCLE.length],
    toT: T_CYCLE[(k + 1) % T_CYCLE.length],
    mid: gapCenter(gapIndex) + staggerOffset(k),
  };
}

function routeRef(edge: SceneEdge, layout: SceneLayout, refIndex: number): SceneEdge {
  return {
    ...edge,
    fromSide: "bottom",
    toSide: "bottom",
    fromT: T_CYCLE[refIndex % T_CYCLE.length],
    toT: T_CYCLE[(refIndex + 1) % T_CYCLE.length],
    mid: layout.worldHeight - REF_LANE_INSET,
  };
}

export function routeEdges(scene: Scene, layout: SceneLayout): SceneEdge[] {
  const nodeById = new Map(scene.nodes.map((n) => [n.id, n] as const));
  const laneIndex = new Map<string, number>();
  scene.nodes
    .filter((n) => n.kind === "column")
    .forEach((n, i) => laneIndex.set(n.id, i));

  const laneOf = (id: string): number => {
    const node = nodeById.get(id);
    return node ? laneIndex.get(node.columnId) ?? 0 : 0;
  };

  const gapCounters = new Map<number, number>();
  let refIndex = 0;
  const routed: SceneEdge[] = [];

  for (const edge of scene.edges) {
    if (edge.kind === "containment") {
      routed.push(routeContainment(edge, nodeById, layout));
    } else if (edge.kind === "ref") {
      routed.push(routeRef(edge, layout, refIndex));
      refIndex += 1;
    } else {
      routed.push(routeRelationship(edge, layout, laneOf, gapCounters));
    }
  }

  return routed;
}
