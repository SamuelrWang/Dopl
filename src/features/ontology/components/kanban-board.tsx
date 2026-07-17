"use client";

import { Plus, Settings2 } from "lucide-react";
import type { Dispatch } from "react";
import { SECTION_BOX_INSET } from "@/shared/ui/section-box";
import type { GraphAction, GraphState } from "../graph-state";
import type { OntologyCluster, OntologyObject } from "../types";
import { KanbanCard } from "./kanban-card";

interface Props {
  cluster: OntologyCluster;
  graph: GraphState;
  dispatch: Dispatch<GraphAction>;
  selectedId: string | null;
  /** Viewers can read the board but can't add cards — hide the affordance. */
  canEdit: boolean;
  onSelect: (id: string) => void;
  onCreateObject: (columnId: string) => void;
}

/**
 * The cluster as columns of object cards. Each column is itself an
 * object: its header edits the name/description in place, and the
 * settings button opens it in the editor panel — where its object
 * template (default fields for new cards) lives. Its children are the
 * cards.
 */
export function KanbanBoard({
  cluster,
  graph,
  dispatch,
  selectedId,
  canEdit,
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
          canEdit={canEdit}
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
  canEdit,
  onSelect,
  onCreateObject,
}: {
  column: OntologyObject;
  graph: GraphState;
  dispatch: Dispatch<GraphAction>;
  selectedId: string | null;
  canEdit: boolean;
  onSelect: (id: string) => void;
  onCreateObject: (columnId: string) => void;
}) {
  return (
    <div className="bento flex w-72 shrink-0 flex-col overflow-hidden">
      <div className="shrink-0">
        <div className="flex items-center gap-2 px-3 pt-2.5">
          <input
            type="text"
            value={col.name}
            onChange={(e) =>
              dispatch({ type: "OBJECT_UPDATE", id: col.id, patch: { name: e.target.value } })
            }
            className="min-w-0 flex-1 bg-transparent text-body font-semibold tracking-tight text-text-primary placeholder:text-text-muted focus:outline-none"
            placeholder="Column name"
            aria-label="Column name"
          />
          <span className="rounded-full bg-surface-raised-4 px-1.5 py-px text-micro font-medium text-text-secondary">
            {col.childIds.length}
          </span>
          <button
            type="button"
            aria-label={`Column settings for ${col.name || "untitled column"}`}
            title="Column settings — object template & fields"
            onClick={() => onSelect(col.id)}
            className="rounded-md p-1 text-text-muted transition hover:bg-surface-raised-3 hover:text-text-primary"
          >
            <Settings2 size={13} />
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
      </div>
      <div
        className={`${SECTION_BOX_INSET} flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 py-2`}
      >
        {col.childIds.map((id) => (
          <KanbanCard
            key={id}
            objectId={id}
            graph={graph}
            selected={selectedId === id}
            onSelect={onSelect}
          />
        ))}
        {canEdit && (
          <button
            type="button"
            onClick={() => onCreateObject(col.id)}
            className="btn-light flex shrink-0 items-center justify-center gap-1 rounded-md px-3 py-1.5 text-small font-medium text-text-primary"
          >
            <Plus size={12} /> Add new
          </button>
        )}
      </div>
    </div>
  );
}
