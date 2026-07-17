"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import {
  EdgeLayer,
  placeNewNode,
  routeEdges,
  useGraphPositions,
  useMeasuredHeights,
  useNodeDrag,
  worldBounds,
  type GraphLayout,
  type NodeRect,
  type Point,
} from "@/shared/graph";
import type { WorkflowGraph } from "../client/types";
import {
  CARD_WIDTH,
  DEFAULT_HEIGHT,
  MIN_WORLD_HEIGHT,
  MIN_WORLD_WIDTH,
  WORLD_PADDING,
  layoutWorkflow,
  toWorkflowSceneEdges,
} from "../graph/layout";
import { useConnectDrag } from "../hooks/use-connect-drag";
import type { WorkflowOps } from "../hooks/use-workflows";
import { ConnectorPreview } from "./connector-preview";
import { EdgeConditionPopover, EdgeInteractionLayer } from "./edge-interaction-layer";
import { StepCard } from "./step-card";
import { WORKFLOW_EDGE_STYLES, WorkflowEdgeMarkers } from "./workflow-edge-styles";

interface Props {
  workflowId: string;
  graph: WorkflowGraph;
  /** Persisted dragged step positions (`{}` = pure auto-layout). */
  storedLayout: GraphLayout;
  selectedId: string | null;
  canEdit: boolean;
  ops: WorkflowOps;
  onSelect: (id: string | null) => void;
  onAddStep: () => void;
  /** Surfaces the reset-to-auto-layout control up to the header (null = nothing
   *  to reset). Stable identity expected. */
  onLayoutResetChange?: (reset: (() => void) | null) => void;
}

interface EdgePopoverState {
  from: string;
  to: string;
  /** Client (viewport) coords the popover portals to. */
  at: Point;
  /** Focus the field on open (fresh connect). */
  autoFocus: boolean;
}

/**
 * The workflow graph viewport: step cards laid out as a left→right layered
 * DAG on a dotted, scrollable substrate, with the shared EdgeLayer routing
 * orthogonal connectors between them. Fully interactive for members:
 *   • drag a card body to reposition it (persisted via `useGraphPositions`);
 *   • drag from a card's output port to another card to connect them
 *     (`useConnectDrag`), then name the branch condition inline;
 *   • click an edge to edit its condition or disconnect.
 * Node heights are measured live (so a text edit re-flows the layout and
 * re-routes edges), and selecting a card dims its non-neighbours. Viewers get
 * a static, read-only graph. The StepPanel remains the accessible path for
 * every edit.
 */
export function WorkflowGraphView({
  workflowId,
  graph,
  storedLayout,
  selectedId,
  canEdit,
  ops,
  onSelect,
  onAddStep,
  onLayoutResetChange,
}: Props) {
  const [edgePopover, setEdgePopover] = useState<EdgePopoverState | null>(null);
  const { heights, registerRef } = useMeasuredHeights();

  const autoLayout = useMemo(
    () => layoutWorkflow(graph.nodes, graph.edges, heights),
    [graph, heights]
  );

  const persistLayout = useCallback(
    (layout: GraphLayout) => ops.saveLayout(workflowId, layout),
    [ops, workflowId]
  );

  const { positions, moveNode, resetLayout, dirty } = useGraphPositions({
    autoPositions: autoLayout.positions,
    storedLayout,
    persist: persistLayout,
  });
  const hasStoredLayout = Object.keys(dirty).length > 0;

  const rects = useMemo(() => {
    const out: Record<string, NodeRect> = {};
    for (const node of graph.nodes) {
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
  }, [graph.nodes, positions, heights]);

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

  const routedEdges = useMemo(
    () => routeEdges(toWorkflowSceneEdges(graph.edges), rects),
    [graph.edges, rects]
  );
  // EdgeLayer draws only strokes/arrows; the interaction layer owns labels.
  const strokeEdges = useMemo(
    () => routedEdges.map((e) => ({ ...e, label: undefined })),
    [routedEdges]
  );

  const scrollRef = useRef<HTMLDivElement | null>(null);

  const { drag, isDragging, onNodePointerDown } = useNodeDrag({
    positions,
    onDragEnd: moveNode,
    scrollRef,
    disabled: !canEdit,
  });

  const onConnect = useCallback(
    async (from: string, to: string, at: Point) => {
      // Open the condition popover ONLY once the connection actually lands —
      // a rejected connect (e.g. a cycle) already toasted; opening the popover
      // would leave it editing an edge that was never created.
      const ok = await ops.connectSteps(workflowId, from, to, "");
      if (ok) setEdgePopover({ from, to, at, autoFocus: true });
    },
    [ops, workflowId]
  );

  const { connect, isConnecting, onPortPointerDown } = useConnectDrag({
    rects,
    scrollRef,
    onConnect,
    disabled: !canEdit,
  });

  const { indegree, outdegree } = useMemo(() => {
    const inDeg = new Map<string, number>();
    const outDeg = new Map<string, number>();
    for (const n of graph.nodes) {
      inDeg.set(n.id, 0);
      outDeg.set(n.id, 0);
    }
    for (const e of graph.edges) {
      inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);
      outDeg.set(e.from, (outDeg.get(e.from) ?? 0) + 1);
    }
    return { indegree: inDeg, outdegree: outDeg };
  }, [graph]);

  const neighborIds = useMemo(() => {
    const ids = new Set<string>();
    if (!selectedId) return ids;
    for (const e of graph.edges) {
      if (e.from === selectedId) ids.add(e.to);
      if (e.to === selectedId) ids.add(e.from);
    }
    return ids;
  }, [graph.edges, selectedId]);

  // Surface the reset control up to the header exactly while a stored
  // position exists (`resetLayout` from the hook + `onLayoutResetChange` are
  // stable, so depending on them directly re-surfaces without extra churn).
  useEffect(() => {
    onLayoutResetChange?.(hasStoredLayout ? resetLayout : null);
    return () => onLayoutResetChange?.(null);
  }, [hasStoredLayout, resetLayout, onLayoutResetChange]);

  // ── New-step placement + scroll-into-view ──────────────────────────────
  // Live values read through refs so the placement effect can key on the node
  // set alone (not re-run on every position/height tick). Synced in an effect
  // (never during render) so the hooks linter stays happy — the placement
  // effect below reads them only after this one has run.
  const canEditRef = useRef(canEdit);
  const selectedIdRef = useRef(selectedId);
  const storedLayoutRef = useRef(storedLayout);
  const rectsRef = useRef(rects);
  const heightsRef = useRef(heights);
  const moveNodeRef = useRef(moveNode);
  useEffect(() => {
    canEditRef.current = canEdit;
    selectedIdRef.current = selectedId;
    storedLayoutRef.current = storedLayout;
    rectsRef.current = rects;
    heightsRef.current = heights;
    moveNodeRef.current = moveNode;
  });

  // A just-added isolated step (no edges) would park in the trailing auto
  // rank, usually off-screen. Drop it into the current viewport instead and
  // persist that — auto-layout keeps governing every undragged node.
  const prevNodeIds = useRef<Set<string> | null>(null);
  const placedIds = useRef(new Set<string>());
  useEffect(() => {
    const ids = new Set(graph.nodes.map((n) => n.id));
    const prev = prevNodeIds.current;
    prevNodeIds.current = ids;
    if (prev === null) return; // first load — adopt existing nodes as-is
    const container = scrollRef.current;
    if (!container || !canEditRef.current) return;
    for (const node of graph.nodes) {
      if (prev.has(node.id)) continue;
      const isolated = !graph.edges.some((e) => e.from === node.id || e.to === node.id);
      if (
        node.id !== selectedIdRef.current ||
        storedLayoutRef.current[node.id] ||
        !isolated
      ) {
        continue;
      }
      const viewport = {
        x: container.scrollLeft,
        y: container.scrollTop,
        width: container.clientWidth,
        height: container.clientHeight,
      };
      const existing = Object.entries(rectsRef.current)
        .filter(([id]) => id !== node.id)
        .map(([, r]) => r);
      const spot = placeNewNode(
        existing,
        { width: CARD_WIDTH, height: heightsRef.current[node.id] ?? DEFAULT_HEIGHT },
        viewport
      );
      placedIds.current.add(node.id);
      moveNodeRef.current(node.id, spot);
    }
  }, [graph.nodes, graph.edges]);

  // Scroll the selected card into view once its position is known (a freshly
  // connected step is off-screen otherwise). Reserve the StepPanel's width so
  // the card lands beside it. A just-placed step is already in view — skip it.
  const lastScrolledId = useRef<string | null>(null);
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    if (!selectedId) {
      if (lastScrolledId.current !== null) {
        container.scrollTo({ left: 0, top: 0 });
        lastScrolledId.current = null;
      }
      return;
    }
    if (lastScrolledId.current === selectedId) return;
    if (placedIds.current.has(selectedId)) {
      lastScrolledId.current = selectedId;
      return;
    }
    const pos = positions[selectedId];
    if (!pos) return; // layout hasn't placed this node yet — try next tick
    const PANEL_RESERVE = 440;
    const viewW = Math.max(container.clientWidth - PANEL_RESERVE, 240);
    const h = heights[selectedId] ?? DEFAULT_HEIGHT;
    container.scrollTo({
      left: Math.max(0, pos.x + pos.width / 2 - viewW / 2),
      top: Math.max(0, pos.y + h / 2 - container.clientHeight / 2),
      behavior: "smooth",
    });
    lastScrolledId.current = selectedId;
  }, [selectedId, positions, heights]);

  const popoverEdge = edgePopover
    ? graph.edges.find((e) => e.from === edgePopover.from && e.to === edgePopover.to)
    : null;
  const popoverTargetName = edgePopover
    ? graph.nodes.find((n) => n.id === edgePopover.to)?.title || "Untitled step"
    : "";

  const closePopover = useCallback(() => setEdgePopover(null), []);

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
          edges={strokeEdges}
          rects={rects}
          focusId={selectedId}
          styles={WORKFLOW_EDGE_STYLES}
          markers={<WorkflowEdgeMarkers />}
        />
        <EdgeInteractionLayer
          edges={routedEdges}
          focusId={selectedId}
          canEdit={canEdit}
          selectedEdge={edgePopover}
          onEdgeClick={(from, to, at) => setEdgePopover({ from, to, at, autoFocus: true })}
        />
        {connect && (
          <ConnectorPreview
            origin={connect.origin}
            pointer={connect.pointer}
            active={connect.targetId !== null}
          />
        )}
        {graph.nodes.map((node) => (
          <StepCard
            key={node.id}
            step={node}
            position={positions[node.id] ?? { x: 0, y: 0, width: 0 }}
            isEntry={(indegree.get(node.id) ?? 0) === 0}
            outCount={outdegree.get(node.id) ?? 0}
            selected={node.id === selectedId}
            dimmed={selectedId !== null && node.id !== selectedId && !neighborIds.has(node.id)}
            onSelect={onSelect}
            registerRef={registerRef}
            onPointerDown={canEdit ? onNodePointerDown : undefined}
            dragOffset={drag?.nodeId === node.id ? { dx: drag.dx, dy: drag.dy } : null}
            isDragging={isDragging}
            connect={
              canEdit
                ? {
                    active: isConnecting,
                    isSource: connect?.sourceId === node.id,
                    isTarget: connect?.targetId === node.id,
                    onPortPointerDown,
                  }
                : undefined
            }
          />
        ))}
      </div>

      {edgePopover && (
        <EdgeConditionPopover
          key={`${edgePopover.from}:${edgePopover.to}`}
          at={edgePopover.at}
          initial={popoverEdge?.condition ?? ""}
          autoFocus={edgePopover.autoFocus}
          targetName={popoverTargetName}
          onChange={(condition) =>
            ops.connectSteps(workflowId, edgePopover.from, edgePopover.to, condition, {
              debounce: true,
            })
          }
          onDisconnect={() => {
            void ops.disconnectSteps(workflowId, edgePopover.from, edgePopover.to);
            setEdgePopover(null);
          }}
          onClose={closePopover}
        />
      )}

      {graph.nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="pointer-events-auto flex flex-col items-center gap-3">
            <p className="text-lead text-text-muted">
              {canEdit
                ? "No steps yet — add the first step of this workflow."
                : "No steps yet — a workspace member or agent can add the first step."}
            </p>
            {canEdit && (
              <button
                type="button"
                onClick={onAddStep}
                className="auth-btn-3d rounded-lg px-4 py-2 text-lead font-semibold text-white"
              >
                <span className="flex items-center gap-1.5">
                  <Plus size={13} /> Add step
                </span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
