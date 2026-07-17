import type { NodeLayout, Scene, SceneLayout } from "./types";

const COLUMN_WIDTH = 240;
export const OBJECT_WIDTH = 280;
export const MARGIN = 150;
export const LANE_PITCH = 630;
export const TOP_Y = 80;
export const DEFAULT_HEIGHT = 180;
export const VGAP_FIRST = 70;
export const VGAP = 60;
export const WORLD_PADDING = 150;
export const MIN_WORLD_WIDTH = 1200;
export const MIN_WORLD_HEIGHT = 800;

const OBJECT_INSET = (COLUMN_WIDTH - OBJECT_WIDTH) / 2;

function heightOf(id: string, heights: Record<string, number>): number {
  return heights[id] ?? DEFAULT_HEIGHT;
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
