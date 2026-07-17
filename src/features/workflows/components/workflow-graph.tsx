"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { EdgeLayer, type NodeRect } from "@/shared/graph";
import type { WorkflowGraph } from "../client/types";
import { DEFAULT_HEIGHT, layoutWorkflow, routeWorkflowEdges } from "../graph/layout";
import { StepCard } from "./step-card";
import { WORKFLOW_EDGE_STYLES, WorkflowEdgeMarkers } from "./workflow-edge-styles";

interface Props {
  graph: WorkflowGraph;
  selectedId: string | null;
  canEdit: boolean;
  onSelect: (id: string | null) => void;
  onAddStep: () => void;
}

/**
 * The workflow graph viewport: step cards laid out as a left→right layered
 * DAG on a dotted, scrollable substrate, with the shared EdgeLayer routing
 * orthogonal connectors between them. Node heights are measured live (so a
 * text edit re-flows the layout and re-routes edges), and selecting a card
 * dims its non-neighbours — mirroring the ontology graph's wiring.
 */
export function WorkflowGraphView({ graph, selectedId, canEdit, onSelect, onAddStep }: Props) {
  const [heights, setHeights] = useState<Record<string, number>>({});
  const idByEl = useRef(new Map<Element, string>());
  const observerRef = useRef<ResizeObserver | null>(null);

  const registerRef = useCallback((id: string, el: HTMLDivElement | null) => {
    observerRef.current ??= new ResizeObserver((entries) => {
      setHeights((prev) => {
        let next: Record<string, number> | null = null;
        for (const entry of entries) {
          const nodeId = idByEl.current.get(entry.target);
          if (!nodeId || !(entry.target instanceof HTMLElement)) continue;
          const height = entry.target.offsetHeight;
          if (prev[nodeId] !== height) {
            next ??= { ...prev };
            next[nodeId] = height;
          }
        }
        return next ?? prev;
      });
    });
    if (el) {
      idByEl.current.set(el, id);
      observerRef.current.observe(el);
    } else {
      for (const [element, nodeId] of idByEl.current) {
        if (nodeId !== id) continue;
        observerRef.current.unobserve(element);
        idByEl.current.delete(element);
      }
    }
  }, []);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  const layout = useMemo(
    () => layoutWorkflow(graph.nodes, graph.edges, heights),
    [graph, heights]
  );
  const edges = useMemo(() => routeWorkflowEdges(graph.edges, layout), [graph.edges, layout]);

  const rects = useMemo(() => {
    const out: Record<string, NodeRect> = {};
    for (const node of graph.nodes) {
      const pos = layout.positions[node.id];
      if (!pos) continue;
      out[node.id] = { x: pos.x, y: pos.y, width: pos.width, height: heights[node.id] ?? DEFAULT_HEIGHT };
    }
    return out;
  }, [graph.nodes, layout, heights]);

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

  // Scroll the selected card into view once its layout position is known (a
  // freshly-added step is parked off-screen otherwise). Reserve the StepPanel's
  // width on the right so the card lands in the visible area beside it. Resets
  // to the top-left when the selection clears (e.g. a tab switch).
  const scrollRef = useRef<HTMLDivElement | null>(null);
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
    const pos = layout.positions[selectedId];
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
  }, [selectedId, layout, heights]);

  return (
    <div
      ref={scrollRef}
      className="relative min-w-0 flex-1 overflow-auto bg-bg-inset shadow-[inset_0_2px_6px_rgba(0,0,0,0.06)]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onSelect(null);
      }}
    >
      <div
        className="relative"
        style={{
          width: layout.worldWidth,
          height: layout.worldHeight,
          backgroundImage: "radial-gradient(rgba(35,42,49,0.07) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onSelect(null);
        }}
      >
        <EdgeLayer
          edges={edges}
          rects={rects}
          focusId={selectedId}
          styles={WORKFLOW_EDGE_STYLES}
          markers={<WorkflowEdgeMarkers />}
        />
        {graph.nodes.map((node) => (
          <StepCard
            key={node.id}
            step={node}
            position={layout.positions[node.id] ?? { x: 0, y: 0, width: 0 }}
            isEntry={(indegree.get(node.id) ?? 0) === 0}
            outCount={outdegree.get(node.id) ?? 0}
            selected={node.id === selectedId}
            dimmed={selectedId !== null && node.id !== selectedId && !neighborIds.has(node.id)}
            onSelect={onSelect}
            registerRef={registerRef}
          />
        ))}
      </div>

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
