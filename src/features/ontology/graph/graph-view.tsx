"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { ObjectPanel } from "../components/object-panel";
import { useOntology } from "../hooks/use-ontology";
import { OntologyResourcesProvider } from "../hooks/use-workspace-resources";
import { deriveScene } from "./derive";
import { EdgeLayer, type NodeRect } from "./edge-layer";
import { GraphNode } from "./graph-node";
import { DEFAULT_HEIGHT, layoutScene, routeEdges } from "./layout";

interface Props {
  workspaceId: string;
}

/**
 * Ontology graph page root (Canvas 2). One cluster per view: its
 * columns become lanes, their descendants node cards, with
 * containment / relationship / ref-attribute edges routed between
 * them. Selecting a node opens the real ObjectPanel editor; node
 * heights are measured live so edits re-route edges immediately.
 */
export function GraphView({ workspaceId }: Props) {
  const { graph, status, dispatch, createCluster, createObject } = useOntology(workspaceId);
  const [clusterId, setClusterId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmDeleteCluster, setConfirmDeleteCluster] = useState(false);
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

  const cluster =
    graph.clusters.find((c) => c.id === clusterId) ?? graph.clusters[0] ?? null;
  // Selection survives only while the object exists — a delete (panel,
  // cluster cascade, remote) hides the panel and undims without an effect.
  const activeSelectedId = selectedId && graph.objects[selectedId] ? selectedId : null;

  const scene = useMemo(
    () => (cluster ? deriveScene(graph, cluster.id) : { nodes: [], edges: [] }),
    [graph, cluster]
  );
  const layout = useMemo(() => layoutScene(scene, heights), [scene, heights]);
  const edges = useMemo(() => routeEdges(scene, layout), [scene, layout]);
  const rects = useMemo(() => {
    const out: Record<string, NodeRect> = {};
    for (const node of scene.nodes) {
      const pos = layout.positions[node.id];
      if (!pos) continue;
      out[node.id] = {
        x: pos.x,
        y: pos.y,
        width: pos.width,
        height: heights[node.id] ?? DEFAULT_HEIGHT,
      };
    }
    return out;
  }, [scene, layout, heights]);

  const neighborIds = useMemo(() => {
    const ids = new Set<string>();
    if (!activeSelectedId) return ids;
    for (const edge of scene.edges) {
      if (edge.from === activeSelectedId) ids.add(edge.to);
      if (edge.to === activeSelectedId) ids.add(edge.from);
    }
    return ids;
  }, [scene, activeSelectedId]);

  const selectCluster = (id: string) => {
    setClusterId(id);
    setSelectedId(null);
    setConfirmDeleteCluster(false);
  };

  const handleCreateCluster = async () => {
    const created = await createCluster();
    if (created) selectCluster(created.id);
  };

  const handleDeleteCluster = () => {
    if (!cluster) return;
    const remaining = graph.clusters.filter((c) => c.id !== cluster.id);
    dispatch({ type: "CLUSTER_DELETE", id: cluster.id });
    setClusterId(remaining[0]?.id ?? null);
    setSelectedId(null);
    setConfirmDeleteCluster(false);
  };

  const handleCreateObject = async (
    target: { clusterId: string } | { parentObjectId: string }
  ) => {
    const object = await createObject(target);
    if (object) setSelectedId(object.id);
  };

  if (status === "loading") {
    return (
      <Frame>
        <p className="m-auto text-lead text-text-muted">Loading ontology…</p>
      </Frame>
    );
  }
  if (status === "error") {
    return (
      <Frame>
        <p className="m-auto text-lead text-danger">
          Couldn&apos;t load the ontology. Refresh to retry.
        </p>
      </Frame>
    );
  }
  if (graph.clusters.length === 0 || !cluster) {
    return (
      <Frame>
        <div className="m-auto flex flex-col items-center gap-3">
          <p className="text-lead text-text-secondary">
            No ontology yet — start with your first cluster.
          </p>
          <button
            type="button"
            onClick={handleCreateCluster}
            className="auth-btn-3d rounded-lg px-4 py-2 text-lead font-semibold text-white"
          >
            New cluster
          </button>
        </div>
      </Frame>
    );
  }

  return (
    <OntologyResourcesProvider workspaceId={workspaceId} graph={graph}>
      <Frame>
        <div className="flex shrink-0 items-center gap-3 border-b border-border-subtle px-3 py-2">
          <div className="concave-track flex items-center gap-1">
            {graph.clusters.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => selectCluster(c.id)}
                className={cn(
                  "flex h-6 items-center gap-1.5 rounded-[6px] px-2.5 text-caption font-medium transition-colors",
                  c.id === cluster.id
                    ? "raised-tab text-text-primary"
                    : "text-text-secondary hover:text-text-primary"
                )}
              >
                {c.name}
                <span className="text-micro text-text-muted">{c.columnIds.length}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={handleCreateCluster}
              aria-label="New cluster"
              className="flex h-6 w-6 items-center justify-center rounded-[6px] text-text-muted transition hover:text-text-primary"
            >
              <Plus size={12} />
            </button>
          </div>
          <div className="flex min-w-0 flex-1 items-baseline gap-2">
            <input
              type="text"
              value={cluster.name}
              onChange={(e) =>
                dispatch({ type: "CLUSTER_UPDATE", id: cluster.id, patch: { name: e.target.value } })
              }
              aria-label="Cluster name"
              className="w-40 shrink-0 bg-transparent text-title font-semibold tracking-tight text-text-primary placeholder:text-text-muted focus:outline-none"
              placeholder="Cluster name"
            />
            <input
              type="text"
              value={cluster.purpose}
              onChange={(e) =>
                dispatch({
                  type: "CLUSTER_UPDATE",
                  id: cluster.id,
                  patch: { purpose: e.target.value },
                })
              }
              aria-label="Cluster purpose"
              className="min-w-0 flex-1 bg-transparent text-body text-text-secondary placeholder:text-text-muted focus:outline-none"
              placeholder="What this ontology anchors (agents read this to route)…"
            />
          </div>
          {confirmDeleteCluster ? (
            <span className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={handleDeleteCluster}
                className="rounded-md bg-danger/10 px-2 py-1 text-caption font-semibold text-danger"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={() => setConfirmDeleteCluster(false)}
                className="btn-light rounded-md px-2 py-1 text-caption font-medium text-text-primary"
              >
                Keep
              </button>
            </span>
          ) : (
            <button
              type="button"
              aria-label={`Delete ${cluster.name || "cluster"}`}
              title="Delete cluster"
              onClick={() => setConfirmDeleteCluster(true)}
              className="btn-light flex h-7 w-8 shrink-0 items-center justify-center rounded-md text-text-primary"
            >
              <Trash2 size={11} />
            </button>
          )}
          <button
            type="button"
            onClick={() => handleCreateObject({ clusterId: cluster.id })}
            className="btn-light flex h-7 shrink-0 items-center gap-1 rounded-md px-2.5 text-small font-medium text-text-primary"
          >
            <Plus size={12} /> Column
          </button>
          <Legend />
        </div>

        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <div
            className="relative min-w-0 flex-1 overflow-auto bg-bg-inset shadow-[inset_0_2px_6px_rgba(0,0,0,0.06)]"
            onClick={(e) => {
              if (e.target === e.currentTarget) setSelectedId(null);
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
                if (e.target === e.currentTarget) setSelectedId(null);
              }}
            >
              <EdgeLayer edges={edges} rects={rects} focusId={activeSelectedId} />
              {scene.nodes.map((node) => (
                <GraphNode
                  key={node.id}
                  node={node}
                  position={layout.positions[node.id] ?? { x: 0, y: 0, width: 0 }}
                  graph={graph}
                  selected={node.id === activeSelectedId}
                  dimmed={
                    activeSelectedId !== null &&
                    node.id !== activeSelectedId &&
                    !neighborIds.has(node.id)
                  }
                  onSelect={setSelectedId}
                  onAddCard={(columnId) => handleCreateObject({ parentObjectId: columnId })}
                  registerRef={registerRef}
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
          {activeSelectedId && (
            <div className="absolute inset-y-1 right-1 z-20 flex">
              <ObjectPanel
                objectId={activeSelectedId}
                graph={graph}
                dispatch={dispatch}
                onSelectObject={setSelectedId}
                onDeleteObject={(id) => dispatch({ type: "OBJECT_DELETE", id })}
                onClose={() => setSelectedId(null)}
              />
            </div>
          )}
        </div>
      </Frame>
    </OntologyResourcesProvider>
  );
}

const LEGEND: Array<{ label: string; className: string }> = [
  { label: "contains", className: "border-t border-dashed border-border-highlight" },
  { label: "relationship", className: "border-t-[1.5px] border-text-secondary" },
  { label: "ref", className: "border-t border-dotted border-text-muted" },
];

function Legend() {
  return (
    <div className="flex shrink-0 items-center gap-3">
      {LEGEND.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5">
          <span className={cn("w-5", item.className)} aria-hidden />
          <span className="text-micro text-text-muted">{item.label}</span>
        </span>
      ))}
    </div>
  );
}

/** The one raised .page-float card above the shell's sidebar panel. */
function Frame({ children }: { children?: React.ReactNode }) {
  return <div className="page-float flex flex-col antialiased">{children}</div>;
}
