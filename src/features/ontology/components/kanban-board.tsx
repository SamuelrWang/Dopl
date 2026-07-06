"use client";

import { Plus } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import type { GraphState } from "../graph-state";
import type { OntologyCluster } from "../types";
import { KanbanCard } from "./kanban-card";
import { TypeDot } from "./ontology-bits";

interface Props {
  cluster: OntologyCluster;
  graph: GraphState;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreateObject: (columnId: string) => void;
}

/**
 * The cluster as columns of object cards. Each column is itself an
 * object — click its header to edit it; its children are the cards.
 */
export function KanbanBoard({
  cluster,
  graph,
  selectedId,
  onSelect,
  onCreateObject,
}: Props) {
  const columns = cluster.columnIds
    .map((id) => graph.objects[id])
    .filter((col): col is NonNullable<typeof col> => Boolean(col));

  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3">
      {columns.map((col) => (
        <div
          key={col.id}
          className={cn(
            "flex w-72 shrink-0 flex-col overflow-hidden rounded-[14px] border bg-[#f1f2f4] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_6px_18px_rgba(0,0,0,0.05)]",
            selectedId === col.id ? "border-black/[0.22]" : "border-black/[0.08]"
          )}
        >
          <button
            type="button"
            onClick={() => onSelect(col.id)}
            className="flex items-center gap-2 px-3 py-2.5 text-left transition hover:bg-black/[0.03]"
            title="Edit column object"
          >
            <TypeDot type={col.type} />
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-tight text-[#232a31]">
              {col.name}
            </span>
            <span className="rounded-full bg-black/[0.06] px-1.5 py-px text-[10.5px] font-medium text-[#646d78]">
              {col.childIds.length}
            </span>
            <span
              role="button"
              tabIndex={0}
              aria-label={`New object in ${col.name}`}
              title="New object"
              onClick={(e) => {
                e.stopPropagation();
                onCreateObject(col.id);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  onCreateObject(col.id);
                }
              }}
              className="btn-light flex h-6 w-7 items-center justify-center rounded-md text-[#232a31]"
            >
              <Plus size={12} />
            </span>
          </button>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
            {col.childIds.map((id) => (
              <KanbanCard
                key={id}
                objectId={id}
                graph={graph}
                selected={selectedId === id}
                onSelect={onSelect}
              />
            ))}
            <button
              type="button"
              onClick={() => onCreateObject(col.id)}
              className="flex items-center justify-center gap-1 rounded-xl border border-dashed border-black/[0.15] px-3 py-2 text-[12px] font-medium text-[#98a2ad] transition hover:border-black/[0.3] hover:text-[#232a31]"
            >
              <Plus size={12} /> Add new
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
