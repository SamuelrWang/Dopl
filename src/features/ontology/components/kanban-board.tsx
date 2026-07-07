"use client";

import { useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import type { Dispatch } from "react";
import { cn } from "@/shared/lib/utils";
import type { GraphAction, GraphState } from "../graph-state";
import type { OntologyCluster, OntologyObject } from "../types";
import { ActionsEditor } from "./actions-editor";
import { AttributesEditor } from "./attributes-editor";
import { KanbanCard } from "./kanban-card";
import { RelationshipsEditor } from "./relationships-editor";

interface Props {
  cluster: OntologyCluster;
  graph: GraphState;
  dispatch: Dispatch<GraphAction>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreateObject: (columnId: string) => void;
}

/**
 * The cluster as columns of object cards. Each column is itself an
 * object: its header edits the name/description in place, and the
 * chevron drops the column's own attributes / relationships / actions
 * open inline. Its children are the cards.
 */
export function KanbanBoard({
  cluster,
  graph,
  dispatch,
  selectedId,
  onSelect,
  onCreateObject,
}: Props) {
  const columns = cluster.columnIds
    .map((id) => graph.objects[id])
    .filter((col): col is OntologyObject => Boolean(col));

  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3">
      {columns.map((col) => (
        <Column
          key={col.id}
          column={col}
          graph={graph}
          dispatch={dispatch}
          selectedId={selectedId}
          onSelect={onSelect}
          onCreateObject={onCreateObject}
        />
      ))}
    </div>
  );
}

function Column({
  column: col,
  graph,
  dispatch,
  selectedId,
  onSelect,
  onCreateObject,
}: {
  column: OntologyObject;
  graph: GraphState;
  dispatch: Dispatch<GraphAction>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreateObject: (columnId: string) => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  return (
    <div className="bento flex w-72 shrink-0 flex-col overflow-hidden bg-bg-inset">
      <div className="shrink-0 border-b border-border-subtle">
        <div className="flex items-center gap-2 px-3 pt-2.5">
          <input
            type="text"
            value={col.name}
            onChange={(e) =>
              dispatch({ type: "OBJECT_UPDATE", id: col.id, patch: { name: e.target.value } })
            }
            className="min-w-0 flex-1 bg-transparent text-lead font-semibold tracking-tight text-text-primary placeholder:text-text-muted focus:outline-none"
            placeholder="Column name"
            aria-label="Column name"
          />
          <span className="rounded-full bg-surface-raised-4 px-1.5 py-px text-micro font-medium text-text-secondary">
            {col.childIds.length}
          </span>
          <button
            type="button"
            aria-label={detailsOpen ? "Hide column details" : "Show column details"}
            title="Column details"
            onClick={() => setDetailsOpen((o) => !o)}
            className="rounded-md p-1 text-text-muted transition hover:bg-surface-raised-3 hover:text-text-primary"
          >
            <ChevronDown
              size={13}
              className={cn("transition-transform", detailsOpen && "rotate-180")}
            />
          </button>
        </div>
        <input
          type="text"
          value={col.subtitle}
          onChange={(e) =>
            dispatch({ type: "OBJECT_UPDATE", id: col.id, patch: { subtitle: e.target.value } })
          }
          placeholder="Describe this column…"
          className="w-full bg-transparent px-3 pb-2 text-caption text-text-secondary placeholder:text-text-muted focus:outline-none"
          aria-label="Column description"
        />
        {detailsOpen && (
          <div className="flex flex-col gap-2.5 border-t border-border-subtle p-2.5">
            <AttributesEditor object={col} graph={graph} dispatch={dispatch} />
            <RelationshipsEditor
              object={col}
              graph={graph}
              dispatch={dispatch}
              onSelectObject={onSelect}
            />
            <ActionsEditor object={col} dispatch={dispatch} />
          </div>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 py-2">
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
          className="btn-light flex shrink-0 items-center justify-center gap-1 rounded-md px-3 py-1.5 text-small font-medium text-text-primary"
        >
          <Plus size={12} /> Add new
        </button>
      </div>
    </div>
  );
}
