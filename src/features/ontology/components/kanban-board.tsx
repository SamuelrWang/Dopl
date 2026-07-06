"use client";

import { Plus } from "lucide-react";
import type { GraphState } from "../graph-state";
import { OBJECT_TYPES } from "../seed";
import type { ObjectTypeId, OntologyCluster } from "../types";
import { KanbanCard } from "./kanban-card";
import { TypeDot } from "./ontology-bits";

const COLUMN_ORDER: ObjectTypeId[] = ["client", "team", "person", "policy", "document"];

interface Props {
  cluster: OntologyCluster;
  graph: GraphState;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreateObject: (type: ObjectTypeId) => void;
}

/**
 * The cluster as columns of object cards, one column per object type
 * (kanban-style). Empty types are hidden; every column can create an
 * object of its type.
 */
export function KanbanBoard({
  cluster,
  graph,
  selectedId,
  onSelect,
  onCreateObject,
}: Props) {
  const rootIds = cluster.objectIds.filter((id) => graph.objects[id]);
  const columns = COLUMN_ORDER.map((type) => ({
    type,
    ids: rootIds.filter((id) => graph.objects[id].type === type),
  })).filter((col) => col.ids.length > 0);

  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3">
      {columns.map(({ type, ids }) => {
        const meta = OBJECT_TYPES[type];
        return (
          <div
            key={type}
            className="flex w-72 shrink-0 flex-col overflow-hidden rounded-[14px] border border-black/[0.08] bg-[#f1f2f4] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_6px_18px_rgba(0,0,0,0.05)]"
          >
            <div className="flex items-center gap-2 px-3 py-2.5">
              <TypeDot type={type} />
              <span className="text-[13px] font-semibold tracking-tight text-[#232a31]">
                {meta.label}s
              </span>
              <span className="rounded-full bg-black/[0.06] px-1.5 py-px text-[10.5px] font-medium text-[#646d78]">
                {ids.length}
              </span>
              <span className="flex-1" />
              <button
                type="button"
                aria-label={`New ${meta.label.toLowerCase()}`}
                title={`New ${meta.label.toLowerCase()}`}
                onClick={() => onCreateObject(type)}
                className="btn-light flex h-6 w-7 items-center justify-center rounded-md text-[#232a31]"
              >
                <Plus size={12} />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
              {ids.map((id) => (
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
                onClick={() => onCreateObject(type)}
                className="flex items-center justify-center gap-1 rounded-xl border border-dashed border-black/[0.15] px-3 py-2 text-[12px] font-medium text-[#98a2ad] transition hover:border-black/[0.3] hover:text-[#232a31]"
              >
                <Plus size={12} /> Add new
              </button>
            </div>
          </div>
        );
      })}
      <NewColumnHint onCreateObject={onCreateObject} existing={columns.map((c) => c.type)} />
    </div>
  );
}

function NewColumnHint({
  onCreateObject,
  existing,
}: {
  onCreateObject: (type: ObjectTypeId) => void;
  existing: ObjectTypeId[];
}) {
  const remaining = COLUMN_ORDER.filter((t) => !existing.includes(t));
  if (remaining.length === 0) return null;
  return (
    <div className="flex w-60 shrink-0 flex-col gap-2 rounded-[14px] border border-dashed border-black/[0.12] p-3">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[#98a2ad]">
        Add a column
      </span>
      {remaining.map((type) => (
        <button
          key={type}
          type="button"
          onClick={() => onCreateObject(type)}
          className="btn-light flex h-7 items-center gap-2 rounded-md px-2.5 text-xs font-medium text-[#232a31]"
        >
          <TypeDot type={type} /> First {OBJECT_TYPES[type].label.toLowerCase()}
        </button>
      ))}
    </div>
  );
}
