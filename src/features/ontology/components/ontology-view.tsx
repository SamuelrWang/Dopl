"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { useOntology } from "../hooks/use-ontology";
import { OntologyResourcesProvider } from "../hooks/use-workspace-resources";
import type { ObjectTypeId } from "../types";
import { KanbanBoard } from "./kanban-board";
import { ObjectPanel } from "./object-panel";

interface Props {
  workspaceId: string;
  workspaceSegment: string;
  /** Deep-linked cluster (`/[ws]/ontology/[clusterSlug]`); first cluster when omitted. */
  initialClusterSlug?: string;
}

/**
 * Ontology page root. One cluster per page; its columns are container
 * objects whose children are the cards. Selecting a card opens the
 * editor panel; every edit persists through use-ontology. The active
 * cluster is URL-addressed by slug (history.replaceState on switch, so
 * tab flips don't remount the page).
 */
export function OntologyView({ workspaceId, workspaceSegment, initialClusterSlug }: Props) {
  const { graph, status, dispatch, createCluster, createObject } = useOntology(workspaceId);
  const [clusterId, setClusterId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const cluster =
    graph.clusters.find((c) => c.id === clusterId) ??
    graph.clusters.find((c) => c.slug === initialClusterSlug) ??
    graph.clusters[0] ??
    null;
  const selected = selectedId ? (graph.objects[selectedId] ?? null) : null;

  const selectCluster = (id: string) => {
    setClusterId(id);
    setSelectedId(null);
    const slug = graph.clusters.find((c) => c.id === id)?.slug;
    if (slug) {
      window.history.replaceState(null, "", `/${workspaceSegment}/ontology/${slug}`);
    }
  };

  const handleCreateCluster = async () => {
    const created = await createCluster();
    if (created) selectCluster(created.id);
  };

  const handleCreateObject = async (
    target: { clusterId: string } | { parentObjectId: string },
    objectType: ObjectTypeId = "person"
  ) => {
    const object = await createObject(target, objectType);
    if (object) setSelectedId(object.id);
  };

  if (status === "loading") {
    return (
      <Frame>
        <p className="m-auto text-[14px] text-[#98a2ad]">Loading ontology…</p>
      </Frame>
    );
  }
  if (status === "error") {
    return (
      <Frame>
        <p className="m-auto text-[14px] text-[#c04543]">
          Couldn&apos;t load the ontology. Refresh to retry.
        </p>
      </Frame>
    );
  }
  if (graph.clusters.length === 0) {
    return (
      <Frame>
        <div className="m-auto flex flex-col items-center gap-3">
          <p className="text-[14px] text-[#646d78]">
            No ontology yet — start with your first cluster.
          </p>
          <button
            type="button"
            onClick={handleCreateCluster}
            className="auth-btn-3d rounded-lg px-4 py-2 text-[14px] font-semibold text-white"
          >
            New cluster
          </button>
        </div>
      </Frame>
    );
  }
  if (!cluster) return <Frame />;

  return (
    <OntologyResourcesProvider workspaceId={workspaceId}>
      <Frame>
        <div className="flex shrink-0 items-center gap-3 border-b border-black/[0.06] px-3 py-2">
          <div className="flex items-center gap-1 rounded-[10px] border border-black/[0.06] bg-[#e9eaec] p-1 shadow-[inset_0_2px_4px_rgba(0,0,0,0.12),inset_0_1px_2px_rgba(0,0,0,0.06),inset_0_-1px_0_rgba(255,255,255,0.85)]">
            {graph.clusters.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => selectCluster(c.id)}
                className={cn(
                  "flex h-7 items-center gap-1.5 rounded-[7px] px-3 text-[13px] font-medium transition-colors",
                  c.id === cluster.id
                    ? "bg-gradient-to-b from-white to-[#f3f3f3] text-[#232a31] shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_0_0_1px_rgba(0,0,0,0.05),0_1px_2px_rgba(0,0,0,0.12),0_3px_6px_rgba(0,0,0,0.08)]"
                    : "text-[#646d78] hover:text-[#232a31]"
                )}
              >
                {c.name}
                <span className="text-[11.5px] text-[#98a2ad]">{c.columnIds.length}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={handleCreateCluster}
              aria-label="New cluster"
              className="flex h-7 w-7 items-center justify-center rounded-[7px] text-[#98a2ad] transition hover:text-[#232a31]"
            >
              <Plus size={13} />
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
              className="w-40 shrink-0 bg-transparent text-[14px] font-semibold tracking-tight text-[#232a31] placeholder:text-[#98a2ad] focus:outline-none"
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
              className="min-w-0 flex-1 bg-transparent text-[13.5px] text-[#646d78] placeholder:text-[#98a2ad] focus:outline-none"
              placeholder="What this ontology anchors (agents read this to route)…"
            />
          </div>
          <button
            type="button"
            onClick={() => handleCreateObject({ clusterId: cluster.id })}
            className="btn-light flex h-7 shrink-0 items-center gap-1 rounded-md px-2.5 text-[13px] font-medium text-[#232a31]"
          >
            <Plus size={12} /> Column
          </button>
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <KanbanBoard
            cluster={cluster}
            graph={graph}
            dispatch={dispatch}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onCreateObject={(columnId) => handleCreateObject({ parentObjectId: columnId })}
          />
          {selected && selectedId && (
            <ObjectPanel
              objectId={selectedId}
              graph={graph}
              dispatch={dispatch}
              onSelectObject={setSelectedId}
              onDeleteObject={(id) => dispatch({ type: "OBJECT_DELETE", id })}
              onClose={() => setSelectedId(null)}
            />
          )}
        </div>
      </Frame>
    </OntologyResourcesProvider>
  );
}

/**
 * Floats the ontology surface as ONE raised white card above the shell's
 * sidebar panel — same geometry as knowledge-v2's `.shell` (margins reveal
 * the lower panel as a frame; no intermediate background of its own).
 */
function Frame({ children }: { children?: React.ReactNode }) {
  return (
    <div className="mt-[7px] mr-2 mb-[9px] ml-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-[#e3e3e0] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.05),0_10px_28px_-8px_rgba(0,0,0,0.16)] antialiased">
      {children}
    </div>
  );
}
