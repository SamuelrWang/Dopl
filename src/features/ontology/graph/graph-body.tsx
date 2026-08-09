"use client";

import { useEffect, useMemo, useRef } from "react";
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
import { isPendingOntologyId } from "../optimistic-create";
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
  /** Optimistically created rows whose POST has not answered — same contract
   *  the kanban lane already honours: their id is provisional, so their node
   *  draws dimmed + inert and neither a drag nor an add-card may address it
   *  (`src/shared/ui/pending.ts`). */
  pendingIds: ReadonlySet<string>;
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
 * The layout write for ONE cluster — or nothing at all while that cluster's id
 * is still provisional. `pending:<uuid>` names no row: the PATCH is rejected on
 * the uuid check and surfaces as a "Couldn't save layout" toast plus a snapshot
 * invalidation, for a drag on a board that is otherwise working fine. Dropping
 * the write loses nothing that was ever saveable — the body is keyed by
 * `cluster.id` upstream, so CREATE_RESOLVE remounts it against the real cluster.
 *
 * Module-level rather than inline in the component because the gate is a
 * decision about an ID, not about React, and is worth testing as one.
 */
export function makeLayoutPersist(
  workspaceId: string,
  clusterId: string,
  onError: (err: unknown) => void
): (layout: GraphLayout) => Promise<void> {
  return async (layoutMap) => {
    if (isPendingOntologyId(clusterId)) return;
    try {
      await api.updateCluster(workspaceId, clusterId, { layout: layoutMap });
    } catch (err) {
      onError(err);
    }
  };
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
  pendingIds,
  selectedId,
  onSelect,
  onAddObject,
  onLayoutError,
  onLayoutResetChange,
}: Props) {
  const { heights, registerRef } = useMeasuredHeights();

  const scene = useMemo(() => deriveScene(graph, cluster.id), [graph, cluster.id]);
  const autoLayout = useMemo(() => layoutScene(scene, heights), [scene, heights]);

  // Persists to THIS cluster's `layout` column, and no-ops while the cluster is
  // still provisional. Failures surface to the caller (toast + refetch) rather
  // than being swallowed — mirrors workflows' saveLayout. `onLayoutError` is a
  // stable callback from the parent.
  const persistLayout = useMemo(
    () => makeLayoutPersist(workspaceId, cluster.id, onLayoutError),
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
        {scene.nodes.map((node) => {
          // A provisional node is not a drag target and not an add-card parent:
          // `moveNode` would persist `pending:<uuid>` into `clusters.layout` as a
          // permanent orphan key, and `createObject({parentObjectId})` would be
          // rejected and roll the card back. Withholding `onPointerDown` is the
          // contract; `pending` carries the same refusal into the node's own
          // add-card button and its dimmed/inert surface.
          const pending = pendingIds.has(node.id);
          return (
            <GraphNode
              key={node.id}
              node={node}
              position={positions[node.id] ?? { x: 0, y: 0, width: 0 }}
              graph={graph}
              canEdit={canEdit}
              pending={pending}
              selected={node.id === selectedId}
              dimmed={selectedId !== null && node.id !== selectedId && !neighborIds.has(node.id)}
              onSelect={onSelect}
              onAddCard={(columnId) => onAddObject({ parentObjectId: columnId })}
              registerRef={registerRef}
              onPointerDown={canEdit && !pending ? onNodePointerDown : undefined}
              dragOffset={drag?.nodeId === node.id ? { dx: drag.dx, dy: drag.dy } : null}
              isDragging={isDragging}
            />
          );
        })}
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
