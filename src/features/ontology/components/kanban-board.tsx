"use client";

import { Plus } from "lucide-react";
import type { Dispatch } from "react";
import { pendingRow } from "@/shared/ui/pending";
import type { GraphAction, GraphState } from "../graph-state";
import type { OntologyCluster, OntologyObject } from "../types";
import { KanbanCard } from "./kanban-card";
import { KanbanColumnHeader } from "./kanban-column-header";

interface Props {
  cluster: OntologyCluster;
  graph: GraphState;
  dispatch: Dispatch<GraphAction>;
  selectedId: string | null;
  /** Optimistically created rows whose POST has not answered — drawn dimmed
   *  and inert, since their id is provisional and nothing may be written at
   *  it yet (`src/shared/ui/pending.ts`). */
  pendingIds: ReadonlySet<string>;
  /** Viewers can read the board but can't add cards — hide the affordance. */
  canEdit: boolean;
  onSelect: (id: string) => void;
  onCreateObject: (columnId: string) => void;
}

/**
 * The cluster as lanes of object cards. Each lane is a flat inset panel
 * carrying white cards: a short header card (the column, whose name edits
 * in place and whose kebab opens it in the editor panel — where its object
 * template lives), then its children, then the add button.
 *
 * The lane supplies its own gray; the board area behind it is the page
 * surface.
 */
export function KanbanBoard({
  cluster,
  graph,
  dispatch,
  selectedId,
  pendingIds,
  canEdit,
  onSelect,
  onCreateObject,
}: Props) {
  const columns = cluster.columnIds
    .map((id) => graph.objects[id])
    .filter((col): col is OntologyObject => Boolean(col));

  return (
    // THE DOT GRID IS LOAD-BEARING GEOMETRY, not decoration, so the numbers
    // have to agree. `.kanban-substrate` tiles at 12px and every dimension out
    // here is a whole number of tiles: board padding p-6 = 24 (2), lane w-72 =
    // 288 (24), gutter gap-3 = 12 (1, so a dot sits dead centre in it), lane
    // padding p-3 = 12 (1). Lane edges land at 24, 324, 624 … — stride 300 =
    // 25 tiles — and the white cards inside them at 36 and 300, all on grid
    // lines. The 12px pitch is FORCED by the 12px gutter: at the inherited
    // 24px pitch every second lane would sit half a tile out.
    //
    // `items-start` is what stops the lanes stretching: each one is now as
    // tall as its own contents, and the vertical overflow belongs to this
    // board (`overflow-auto`), not to a scrollbar inside every lane.
    <div className="graph-substrate kanban-substrate flex min-h-0 flex-1 items-start gap-3 overflow-auto p-6">
      {columns.map((col) => (
        <Column
          key={col.id}
          column={col}
          graph={graph}
          dispatch={dispatch}
          selectedId={selectedId}
          pendingIds={pendingIds}
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
  pendingIds,
  canEdit,
  onSelect,
  onCreateObject,
}: {
  column: OntologyObject;
  graph: GraphState;
  dispatch: Dispatch<GraphAction>;
  selectedId: string | null;
  pendingIds: ReadonlySet<string>;
  canEdit: boolean;
  onSelect: (id: string) => void;
  onCreateObject: (columnId: string) => void;
}) {
  return (
    // A pending column takes its whole lane inert with it — header inputs,
    // its menu and the add button all address an id the server has not
    // minted yet.
    <div
      {...pendingRow(
        pendingIds.has(col.id),
        "flex w-72 shrink-0 flex-col gap-2 self-start rounded-[14px] bg-bg-inset p-3"
      )}
    >
      <KanbanColumnHeader
        column={col}
        graph={graph}
        dispatch={dispatch}
        canEdit={canEdit}
        selected={selectedId === col.id}
        onSelect={onSelect}
        onCreateObject={onCreateObject}
      />
      {/* No scroller of its own any more: the lane hugs its cards and the
          board scrolls. */}
      <div className="flex flex-col gap-2">
        {col.childIds.map((id) => (
          <KanbanCard
            key={id}
            objectId={id}
            graph={graph}
            selected={selectedId === id}
            pending={pendingIds.has(id)}
            onSelect={onSelect}
          />
        ))}
        {canEdit && (
          // Hugs the left corner AFTER the last card rather than filling the
          // lane: it is the next row in the list, not a footer for it.
          <button
            type="button"
            onClick={() => onCreateObject(col.id)}
            aria-label={`Add object to ${col.name || "untitled column"}`}
            className="btn-light flex shrink-0 items-center gap-1 self-start rounded-md px-2.5 py-1.5 text-small font-medium text-text-primary"
          >
            <Plus size={12} /> {col.name || "Add"}
          </button>
        )}
      </div>
    </div>
  );
}
