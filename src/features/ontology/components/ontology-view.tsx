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
import { KanbanBoard } from "./kanban-board";
import { ObjectPanel } from "./object-panel";

/**
 * Ontology page root — static in-memory editor. One cluster per page;
 * its columns are container objects whose children are the cards.
 * Selecting a card or a column header opens the editor panel on the
 * right. Edits live in local state only.
 */
export function OntologyView() {
  const [graph, dispatch] = useGraph();
  const [clusterId, setClusterId] = useState(graph.clusters[0].id);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const cluster =
    graph.clusters.find((c) => c.id === clusterId) ?? graph.clusters[0];
  const selected = selectedId ? (graph.objects[selectedId] ?? null) : null;

  const createCard = (columnId: string) => {
    const id = newObjectId();
    const column = graph.objects[columnId];
    dispatch({
      type: "OBJECT_CREATE",
      clusterId: cluster.id,
      parentId: columnId,
      object: makeBlankObject(id, column?.type ?? "person"),
    });
    setSelectedId(id);
  };

  const createColumn = () => {
    const id = newObjectId();
    dispatch({
      type: "OBJECT_CREATE",
      clusterId: cluster.id,
      object: makeBlankObject(id, "person", "Untitled column"),
    });
    const firstCardId = newObjectId();
    dispatch({
      type: "OBJECT_CREATE",
      clusterId: cluster.id,
      parentId: id,
      object: makeBlankObject(firstCardId, "person"),
    });
    setSelectedId(id);
  };

  const createCluster = () => {
    const id = newClusterId();
    dispatch({
      type: "CLUSTER_CREATE",
      cluster: { id, name: "New cluster", purpose: "", columnIds: [] },
    });
    const columnId = newObjectId();
    dispatch({
      type: "OBJECT_CREATE",
      clusterId: id,
      object: makeBlankObject(columnId, "person", "Untitled column"),
    });
    const firstCardId = newObjectId();
    dispatch({
      type: "OBJECT_CREATE",
      clusterId: id,
      parentId: columnId,
      object: makeBlankObject(firstCardId, "person"),
    });
    setClusterId(id);
    setSelectedId(firstCardId);
  };

  const selectCluster = (id: string) => {
    setClusterId(id);
    setSelectedId(null);
  };

  return (
    <div className="flex min-h-0 w-full flex-1 overflow-hidden bg-[#e6e8eb] p-2">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-black/[0.1] bg-[#fbfcfd] shadow-[0_1px_2px_rgba(0,0,0,0.05),0_10px_28px_-8px_rgba(0,0,0,0.16)]">
        <div className="flex shrink-0 items-center gap-3 border-b border-black/[0.06] px-3 py-2">
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
                <span className="text-[10px] text-[#98a2ad]">{c.columnIds.length}</span>
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
            onClick={createColumn}
            className="btn-light flex h-7 shrink-0 items-center gap-1 rounded-md px-2.5 text-xs font-medium text-[#232a31]"
          >
            <Plus size={12} /> Column
          </button>
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <KanbanBoard
            cluster={cluster}
            graph={graph}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onCreateObject={createCard}
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
      </div>
    </div>
  );
}
