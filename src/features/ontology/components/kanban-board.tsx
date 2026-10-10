"use client";

import { Plus } from "lucide-react";
import { useCallback, type Dispatch } from "react";
import { cn } from "@/shared/lib/utils";
import { pendingRow } from "@/shared/ui/pending";
import type { GraphAction, GraphState } from "../graph-state";
import { useBoardDisplay, type BoardDisplay } from "../hooks/use-board-display";
import { useRowsCollapsed } from "../hooks/use-rows-collapsed";
import { NEW_COLUMN_NAME } from "../optimistic-create";
import type { Ontology, OntologyObject } from "../types";
import { KanbanCard } from "./kanban-card";
import { KanbanColumnHeader } from "./kanban-column-header";
import { OntologyRow } from "./ontology-row";
import { RowsChevron, RowsCollapse } from "./rows-collapse";

interface Props {
  ontology: Ontology;
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
  /** `canvas`: lanes of cards. `rows`: full-width sections, objects as
   *  full-width rows. Omitted ⇒ this device's choice (`use-board-display.ts`),
   *  set by the header's `BoardDisplayMenu`. */
  display?: BoardDisplay;
}

/**
 * The ontology as lanes of item cards. Each lane is an OBJECT: header card (the
 * object type — name edits in place, kebab opens it in the editor panel), then
 * its items, then the add button. The lane supplies its own gray; the
 * board behind it is the page surface.
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
  // Rows only: folded lanes and rows, remembered per ontology on this device.
  const exists = useCallback(
    (id: string) => Boolean(graph.objects[id]),
    [graph.objects]
  );
  const { collapsed, toggle } = useRowsCollapsed(ontology.id, exists);

  return (
    // The dot grid is load-bearing geometry. `.kanban-substrate` tiles at 12px and
    // every dimension here is a whole number of tiles: p-6 = 24 (2), lane w-72 =
    // 288 (24), gutter gap-3 = 12 (1, dot dead centre), lane p-3 = 12 (1). Lane
    // edges land at 24, 324, 624 … (stride 300 = 25 tiles), cards at 36 and 300.
    // The 12px pitch is forced by the 12px gutter — at a 24px pitch every second
    // lane sits half a tile out.
    //
    // No fill on this element: the lanes supply the only gray on the board
    // (`bg-home-panel` below).
    //
    // `items-start` stops lanes stretching: each is as tall as its contents and
    // vertical overflow belongs to this board, not a scrollbar per lane.
    //
    // Rows: the same lanes stacked top to bottom at the board's full width. Lane
    // edges stay on the tile grid; only the width stops being 24 tiles.
    <div
      className={cn(
        "graph-substrate kanban-substrate flex min-h-0 flex-1 gap-3 overflow-auto p-6",
        display === "rows" ? "flex-col items-stretch" : "items-start"
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
  /** Rows only: ids folded shut (lanes and object rows alike). */
  collapsed: ReadonlySet<string>;
  onToggleCollapsed: (id: string) => void;
}) {
  const laneOpen = !rows || !collapsed.has(col.id);
  const header = (
    <KanbanColumnHeader
      column={col}
      graph={graph}
      dispatch={dispatch}
      canEdit={canEdit}
      selected={selectedId === col.id}
      onSelect={onSelect}
      onCreateObject={onCreateObject}
    />
  );
  /** `+ Lead` once named; `+ Untitled object` while the lane still is not. */
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
        // Hugs the left corner after the last card: the next row in the list,
        // not a footer.
        //
        // The label is the object's own name (Samuel, 2026-09-11) — the button
        // adds an item of this object type, so it reads `+ Lead`; only an unnamed
        // lane falls back to `NEW_COLUMN_NAME`. `min-w-0` + `truncate` because
        // the label is user text in a fixed `w-72` lane and must ellipsise inside
        // the pill rather than widen it.
        <button
          type="button"
          onClick={() => onCreateObject(col.id)}
          aria-label={`Add ${addLabel}`}
          className="btn-light flex min-w-0 max-w-full shrink-0 items-center gap-1 self-start rounded-md px-2.5 py-1.5 text-small font-medium text-text-primary"
        >
          <Plus size={12} className="shrink-0" />
          <span className="min-w-0 truncate">{addLabel}</span>
        </button>
      )}
    </>
  );
  return (
    // A pending column takes its whole lane inert: header inputs, menu and add
    // button all address an id the server hasn't minted yet.
    //
    // The lane's gray is the tab-switcher panel's (Samuel, 2026-09-11):
    // `--home-panel`, by token and never a hex, and the skeleton lane wears the
    // same one (`ontology-skeleton.tsx`).
    <div
      {...pendingRow(
        pendingIds.has(col.id),
        cn(
          "flex shrink-0 flex-col rounded-[14px] bg-home-panel p-3",
          // Rows: no flex gap; the fold carries its own top padding so a closed
          // lane does not keep an 8px gap under its header.
          rows ? "w-full" : "w-72 gap-2 self-start"
        )
      )}
    >
      {rows ? (
        // Rows: the type card keeps its canvas width (264 = the lane's inner
        // width there) and the lane's fold chevron sits at the far right.
        <div className="flex items-start gap-2">
          <div className="flex w-full max-w-[264px] min-w-0 flex-col">
            {header}
          </div>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => onToggleCollapsed(col.id)}
            aria-expanded={laneOpen}
            aria-label={`${laneOpen ? "Collapse" : "Expand"} ${col.name || NEW_COLUMN_NAME}`}
            title={laneOpen ? "Collapse" : "Expand"}
            className="shrink-0 rounded-md p-1.5 text-text-muted transition hover:bg-surface-raised-3 hover:text-text-primary"
          >
            <RowsChevron open={laneOpen} size={14} />
          </button>
        </div>
      ) : (
        header
      )}
      {/* No scroller here: lane hugs its cards, the board scrolls. */}
      {rows ? (
        // `-mx-1 px-1`: the fold clips, so give row shadows and the selected
        // ring room at the sides without moving the rows.
        <RowsCollapse
          open={laneOpen}
          className="-mx-1 flex flex-col gap-2 px-1 pt-2"
        >
          {items}
        </RowsCollapse>
      ) : (
        <div className="flex flex-col gap-2">{items}</div>
      )}
    </div>
  );
}
