"use client";

import { Plus } from "lucide-react";
import { useCallback, type Dispatch } from "react";
import { cn } from "@/shared/lib/utils";
import { PANEL_WELL } from "@/shared/ui/panel-well";
import { pendingRow } from "@/shared/ui/pending";
import type { GraphAction, GraphState } from "../graph-state";
import { useBoardDisplay, type BoardDisplay } from "../hooks/use-board-display";
import { useRowsCollapsed } from "../hooks/use-rows-collapsed";
import { NEW_COLUMN_NAME } from "../optimistic-create";
import type { Ontology, OntologyObject } from "../types";
import { KanbanCard } from "./kanban-card";
import { KanbanColumnHeader } from "./kanban-column-header";
import { ADD_OBJECT_BUTTON } from "./ontology-bits";
import { OntologyRow } from "./ontology-row";
import { OntologyRowsGroupHeader } from "./ontology-rows-group-header";
import { RowsCollapse } from "./rows-collapse";

interface Props {
  ontology: Ontology;
  graph: GraphState;
  dispatch: Dispatch<GraphAction>;
  selectedId: string | null;
  /** Optimistically created rows whose POST has not answered — drawn dimmed and inert, since
   *  their id is provisional (`src/shared/ui/pending.ts`). */
  pendingIds: ReadonlySet<string>;
  /** Viewers can read the board but can't add cards — hide the affordance. */
  canEdit: boolean;
  onSelect: (id: string) => void;
  onCreateObject: (columnId: string) => void;
  /** `canvas`: lanes of cards. `rows`: full-width groups of records. Omitted ⇒ this device's
   *  choice (`use-board-display.ts`), set by the header's `BoardDisplayMenu`. */
  display?: BoardDisplay;
}

/**
 * The ontology board. Each lane (canvas) or group (rows) is an OBJECT TYPE: its header, then its
 * objects as white cards, then the add button.
 *
 * Canvas sits on the kit's dotted ground, whose 12px pitch the geometry lands on: padding 24, lane
 * 288, gutter 12. Lanes take no fill of their own and hug their cards; the board scrolls. Rows has
 * no spatial placement, so it drops the dots and puts each group in the gray well (`PANEL_WELL`).
 */
export function KanbanBoard({
  ontology,
  graph,
  dispatch,
  selectedId,
  pendingIds,
  canEdit,
  onSelect,
  onCreateObject,
  display: displayProp,
}: Props) {
  const [stored] = useBoardDisplay();
  const display = displayProp ?? stored;
  const columns = ontology.columnIds
    .map((id) => graph.objects[id])
    .filter((col): col is OntologyObject => Boolean(col));
  // Rows only: folded groups and records, remembered per ontology on this device.
  const exists = useCallback((id: string) => Boolean(graph.objects[id]), [graph.objects]);
  const { collapsed, toggle } = useRowsCollapsed(ontology.id, exists);

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 overflow-auto",
        display === "rows"
          ? "flex-col items-stretch gap-3 px-5 pt-4.5 pb-7"
          : "graph-substrate kanban-substrate items-start gap-3 p-6"
      )}
    >
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
          rows={display === "rows"}
          collapsed={collapsed}
          onToggleCollapsed={toggle}
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
  rows,
  collapsed,
  onToggleCollapsed,
}: {
  column: OntologyObject;
  graph: GraphState;
  dispatch: Dispatch<GraphAction>;
  selectedId: string | null;
  pendingIds: ReadonlySet<string>;
  canEdit: boolean;
  onSelect: (id: string) => void;
  onCreateObject: (columnId: string) => void;
  rows: boolean;
  /** Rows only: ids folded shut (groups and records alike). */
  collapsed: ReadonlySet<string>;
  onToggleCollapsed: (id: string) => void;
}) {
  const laneOpen = !rows || !collapsed.has(col.id);
  const recordsId = `type-records-${col.id}`;
  /** `+ Lead` once named; `+ Untitled object` while the type still is not. */
  const addLabel = col.name || NEW_COLUMN_NAME;
  const items = (
    <>
      {col.childIds.map((id) =>
        rows ? (
          <OntologyRow
            key={id}
            objectId={id}
            graph={graph}
            selected={selectedId === id}
            pending={pendingIds.has(id)}
            onSelect={onSelect}
            open={!collapsed.has(id)}
            onToggleOpen={() => onToggleCollapsed(id)}
          />
        ) : (
          <KanbanCard
            key={id}
            objectId={id}
            graph={graph}
            selected={selectedId === id}
            pending={pendingIds.has(id)}
            onSelect={onSelect}
          />
        )
      )}
      {canEdit && (
        <button
          type="button"
          onClick={() => onCreateObject(col.id)}
          aria-label={`Add ${addLabel}`}
          className={ADD_OBJECT_BUTTON}
        >
          <Plus size={12} className="shrink-0" />
          <span className="min-w-0 truncate">{addLabel}</span>
        </button>
      )}
    </>
  );
  return (
    // A pending type takes its whole lane inert: every control in it addresses an id the server
    // has not minted yet.
    <div
      {...pendingRow(
        pendingIds.has(col.id),
        rows
          ? cn(PANEL_WELL, "w-full shrink-0 gap-0")
          : "flex w-72 shrink-0 flex-col gap-2 self-start"
      )}
    >
      {rows ? (
        <OntologyRowsGroupHeader
          column={col}
          graph={graph}
          dispatch={dispatch}
          canEdit={canEdit}
          open={laneOpen}
          onToggleOpen={() => onToggleCollapsed(col.id)}
          recordsId={recordsId}
          onSelect={onSelect}
          onCreateObject={onCreateObject}
        />
      ) : (
        <KanbanColumnHeader
          column={col}
          graph={graph}
          dispatch={dispatch}
          canEdit={canEdit}
          selected={selectedId === col.id}
          onSelect={onSelect}
          onCreateObject={onCreateObject}
        />
      )}
      {rows ? (
        // `-mx-1 px-1`: the fold clips, so give the records' shadows and the selected bar room.
        <RowsCollapse id={recordsId} open={laneOpen} className="-mx-1 flex flex-col gap-2.5 px-1 pt-3 pb-1">
          {items}
        </RowsCollapse>
      ) : (
        <div className="flex flex-col gap-2">{items}</div>
      )}
    </div>
  );
}
