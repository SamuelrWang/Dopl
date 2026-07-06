"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import {
  makeBlankObject,
  newClusterId,
  newObjectId,
  useGraph,
} from "../graph-state";
import type { ObjectTypeId } from "../types";
import { KanbanBoard } from "./kanban-board";
import { ObjectPanel } from "./object-panel";

/**
 * Ontology page root — static in-memory editor. One cluster per page as
 * columns of object cards grouped by type; selecting a card opens the
 * editor panel on the right. Edits live in local state only.
 */
export function OntologyView() {
  const [graph, dispatch] = useGraph();
  const [clusterId, setClusterId] = useState(graph.clusters[0].id);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const cluster =
    graph.clusters.find((c) => c.id === clusterId) ?? graph.clusters[0];
  const selected = selectedId ? (graph.objects[selectedId] ?? null) : null;

  const createObject = (type: ObjectTypeId = "person", parentId?: string) => {
    const id = newObjectId();
    dispatch({
      type: "OBJECT_CREATE",
      clusterId: cluster.id,
      parentId,
      object: makeBlankObject(id, type),
    });
    setSelectedId(id);
  };

  const createCluster = () => {
    const id = newClusterId();
    dispatch({
      type: "CLUSTER_CREATE",
      cluster: { id, name: "New cluster", purpose: "", objectIds: [] },
    });
    setClusterId(id);
    setSelectedId(null);
  };

  const selectCluster = (id: string) => {
    setClusterId(id);
    setSelectedId(null);
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-2 overflow-hidden bg-[#e6e8eb] p-2">
      <div className="flex shrink-0 items-center gap-3 rounded-[14px] border border-black/[0.08] bg-[#fbfcfd] px-3 py-2 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_6px_18px_rgba(0,0,0,0.05)]">
        <h1 className="px-1 text-sm font-semibold tracking-tight text-[#232a31]">
          Ontology
        </h1>
        <div className="flex items-center gap-1 rounded-[10px] border border-black/[0.06] bg-[#e9eaec] p-1 shadow-[inset_0_2px_4px_rgba(0,0,0,0.12),inset_0_1px_2px_rgba(0,0,0,0.06),inset_0_-1px_0_rgba(255,255,255,0.85)]">
          {graph.clusters.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => selectCluster(c.id)}
              className={cn(
                "flex h-7 items-center gap-1.5 rounded-[7px] px-3 text-xs font-medium transition-colors",
                c.id === cluster.id
                  ? "bg-gradient-to-b from-white to-[#f3f3f3] text-[#232a31] shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_0_0_1px_rgba(0,0,0,0.05),0_1px_2px_rgba(0,0,0,0.12),0_3px_6px_rgba(0,0,0,0.08)]"
                  : "text-[#646d78] hover:text-[#232a31]"
              )}
            >
              {c.name}
              <span className="text-[10px] text-[#98a2ad]">{c.objectIds.length}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={createCluster}
            aria-label="New cluster"
            className="flex h-7 w-7 items-center justify-center rounded-[7px] text-[#98a2ad] transition hover:text-[#232a31]"
          >
            <Plus size={13} />
          </button>
        </div>
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-[#646d78]">
          {cluster.purpose}
        </span>
        <button
          type="button"
          onClick={() => createObject()}
          className="btn-light flex h-7 shrink-0 items-center gap-1 rounded-md px-2.5 text-xs font-medium text-[#232a31]"
        >
          <Plus size={12} /> Object
        </button>
      </div>

      <div className="flex min-h-0 flex-1 gap-2 overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-black/[0.08] bg-[#eef1f5] shadow-[inset_0_2px_4px_rgba(0,0,0,0.1),inset_0_1px_2px_rgba(0,0,0,0.06),inset_0_-1px_0_rgba(255,255,255,0.9)]">
          <KanbanBoard
            cluster={cluster}
            graph={graph}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onCreateObject={(type) => createObject(type)}
          />
        </div>
        {selected && selectedId && (
          <ObjectPanel
            objectId={selectedId}
            graph={graph}
            dispatch={dispatch}
            onSelectObject={setSelectedId}
            onCreateChild={(parentId) => createObject("person", parentId)}
            onDeleteObject={(id) => dispatch({ type: "OBJECT_DELETE", id })}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>
    </div>
  );
}
