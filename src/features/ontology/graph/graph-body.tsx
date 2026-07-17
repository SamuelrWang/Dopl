"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  EdgeLayer,
  routeEdges,
  useGraphPositions,
  useMeasuredHeights,
  useNodeDrag,
  worldBounds,
  type GraphLayout,
  type NodeRect,
} from "@/shared/graph";
import * as api from "../client/api";
import type { GraphState } from "../graph-state";
import type { OntologyCluster } from "../types";
import { deriveScene } from "./derive";
import { ONTOLOGY_EDGE_STYLES, OntologyEdgeMarkers } from "./edge-styles";
import { GraphNode } from "./graph-node";
import {
  DEFAULT_HEIGHT,
  MIN_WORLD_HEIGHT,
  MIN_WORLD_WIDTH,
  WORLD_PADDING,
  layoutScene,
} from "./layout";

interface Props {
  workspaceId: string;
  graph: GraphState;
  /** The cluster this body renders. The parent keys the body by `cluster.id`
   *  so a switch remounts it — the persist target is fixed for its lifetime
   *  and the unmount flush lands any pending drag on the right cluster. */
  cluster: OntologyCluster;
  canEdit: boolean;
  /** Currently-selected object (already validated to still exist). */
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAddObject: (target: { clusterId: string } | { parentObjectId: string }) => void;
  /** Called with the raised error when a layout persist rejects. */
  onLayoutError: (err: unknown) => void;
  /** Surfaces the reset-to-auto-layout control up to the header (null =
   *  nothing to reset). Stable identity expected. */
  onLayoutResetChange: (reset: (() => void) | null) => void;
}

/**
 * The ontology graph viewport for ONE cluster: its columns become lanes,
 * their descendants node cards, with containment / relationship / ref edges
 * routed between them via the shared EdgeLayer. Keyed by `cluster.id` upstream
 * so `useGraphPositions` closes over a fixed persist target — a realtime
 * cluster reorder/delete can never retarget a pending drag write, and the
 * unmount flush lands it on the correct cluster. Node heights are measured
 * live so an edit re-routes edges immediately; selecting a card dims its
 * non-neighbours. Viewers get a static, read-only graph.
 */
export function OntologyGraphBody({
  workspaceId,
  graph,
  cluster,
  canEdit,
  selectedId,
  onSelect,
  onAddObject,
  onLayoutError,
  onLayoutResetChange,
}: Props) {
  const { heights, registerRef } = useMeasuredHeights();

  const scene = useMemo(() => deriveScene(graph, cluster.id), [graph, cluster.id]);
  const autoLayout = useMemo(() => layoutScene(scene, heights), [scene, heights]);

  // Persists to THIS cluster's `layout` column. Failures surface to the caller
  // (toast + refetch) rather than being swallowed — mirrors workflows' saveLayout.
  // `onLayoutError` is a stable callback from the parent.
  const persistLayout = useCallback(
    async (layoutMap: GraphLayout) => {
      try {
        await api.updateCluster(workspaceId, cluster.id, { layout: layoutMap });
      } catch (err) {
        onLayoutError(err);
      }
    },
    [workspaceId, cluster.id, onLayoutError]
  );

  const { positions, moveNode, resetLayout, dirty } = useGraphPositions({
    autoPositions: autoLayout.positions,
    storedLayout: cluster.layout ?? null,
    persist: persistLayout,
  });
  const hasStoredLayout = Object.keys(dirty).length > 0;

  // Surface the reset control up to the header exactly while a stored position
  // exists (`resetLayout` from the hook + `onLayoutResetChange` are stable).
  useEffect(() => {
    onLayoutResetChange(hasStoredLayout ? resetLayout : null);
    return () => onLayoutResetChange(null);
  }, [hasStoredLayout, resetLayout, onLayoutResetChange]);

  const rects = useMemo(() => {
    const out: Record<string, NodeRect> = {};
    for (const node of scene.nodes) {
      const pos = positions[node.id];
      if (!pos) continue;
      out[node.id] = {
        x: pos.x,
        y: pos.y,
        width: pos.width,
        height: heights[node.id] ?? DEFAULT_HEIGHT,
      };
    }
    return out;
  }, [scene, positions, heights]);

  // World spans the effective (dragged) rects, not the auto bounds — a card
  // dragged past the auto extent stays inside the scrollable world.
  const world = useMemo(
    () =>
      worldBounds(Object.values(rects), WORLD_PADDING, {
        width: MIN_WORLD_WIDTH,
        height: MIN_WORLD_HEIGHT,
      }),
    [rects]
  );
  const edges = useMemo(() => routeEdges(scene.edges, rects), [scene.edges, rects]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const { drag, isDragging, onNodePointerDown } = useNodeDrag({
    positions,
    onDragEnd: moveNode,
    scrollRef,
    disabled: !canEdit,
  });

  const neighborIds = useMemo(() => {
    const ids = new Set<string>();
    if (!selectedId) return ids;
    for (const edge of scene.edges) {
      if (edge.from === selectedId) ids.add(edge.to);
      if (edge.to === selectedId) ids.add(edge.from);
    }
    return ids;
  }, [scene, selectedId]);

  return (
    <div
      ref={scrollRef}
      className="relative min-w-0 flex-1 overflow-auto bg-bg-inset shadow-[inset_0_2px_6px_rgba(0,0,0,0.06)]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onSelect(null);
      }}
    >
      <div
        className="graph-substrate relative"
        style={{ width: world.width, height: world.height }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onSelect(null);
        }}
      >
        <EdgeLayer
          edges={edges}
          rects={rects}
          focusId={selectedId}
          styles={ONTOLOGY_EDGE_STYLES}
          markers={<OntologyEdgeMarkers />}
        />
        {scene.nodes.map((node) => (
          <GraphNode
            key={node.id}
            node={node}
            position={positions[node.id] ?? { x: 0, y: 0, width: 0 }}
            graph={graph}
            canEdit={canEdit}
            selected={node.id === selectedId}
            dimmed={selectedId !== null && node.id !== selectedId && !neighborIds.has(node.id)}
            onSelect={onSelect}
            onAddCard={(columnId) => onAddObject({ parentObjectId: columnId })}
            registerRef={registerRef}
            onPointerDown={canEdit ? onNodePointerDown : undefined}
            dragOffset={drag?.nodeId === node.id ? { dx: drag.dx, dy: drag.dy } : null}
            isDragging={isDragging}
          />
        ))}
      </div>
      {scene.nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="text-lead text-text-muted">
            This cluster is empty — add a column to start the graph.
          </p>
        </div>
      )}
    </div>
  );
}
