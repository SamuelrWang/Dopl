/** Generic graph-drawing substrate — see ./types + ./edge-layer. */

export { EdgeLayer, type EdgeStyle } from "./edge-layer";
export {
  routeEdges,
  labelAnchor,
  chooseRouting,
  DEFAULT_STUB,
  DEFAULT_LANE_GAP,
  type RouteOptions,
} from "./route-edges";
export {
  resolvePositions,
  pruneLayout,
  mergeStoredLayout,
  placeNewNode,
  worldBounds,
} from "./positions";
export { graphLayoutSchema, MAX_LAYOUT_NODES, type GraphLayoutInput } from "./layout-schema";
export {
  useNodeDrag,
  type NodeDragState,
  type UseNodeDrag,
  type UseNodeDragParams,
} from "./use-node-drag";
export {
  useGraphPositions,
  type UseGraphPositions,
  type UseGraphPositionsParams,
} from "./use-graph-positions";
export { useMeasuredHeights } from "./use-measured-heights";
export {
  snap,
  snapPoint,
  exceededThreshold,
  autoScrollDelta,
} from "./drag-math";
export type {
  EdgeSide,
  GraphLayout,
  NodeLayout,
  NodeRect,
  Point,
  SceneEdge,
  SceneLayout,
  SceneNode,
} from "./types";
