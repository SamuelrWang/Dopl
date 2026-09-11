"use client";

import { Plus } from "lucide-react";
import type { Dispatch } from "react";
import { pendingRow } from "@/shared/ui/pending";
import type { GraphAction, GraphState } from "../graph-state";
import { NEW_COLUMN_NAME } from "../optimistic-create";
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
 * The ontology as lanes of item cards. Each lane is an OBJECT: header card (the
 * object type — name edits in place, kebab opens it in the editor panel), then
 * its items, then the add button. The lane supplies its own gray; the
 * board behind it is the page surface.
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
    // ⚠ **THE DOT GRID IS BACK** (Samuel, 2026-09-11: *"I don't see the dots, the
    // dotted grid. I want to bring that dotted grid back"*). It was taken off on
    // 2026-09-10 reading it as the inner panel of a *"double panel"*; what he
    // actually objected to was the FILL, and the dots are drawn on the white
    // surface with no background under them — so the panel stays single and the
    // grid returns exactly as it was (`git show 8d85b59a^`).
    //
    // ⚠ THE DOT GRID IS LOAD-BEARING GEOMETRY. `.kanban-substrate` tiles at 12px
    // and every dimension here is a whole number of tiles: p-6 = 24 (2), lane
    // w-72 = 288 (24), gutter gap-3 = 12 (1, dot dead centre), lane p-3 = 12 (1).
    // Lane edges land at 24, 324, 624 … (stride 300 = 25 tiles), cards at 36 and
    // 300. The 12px pitch is FORCED by the 12px gutter — at the inherited 24px
    // pitch every second lane sits half a tile out.
    //
    // ⚠ Still NO FILL on this element: the lanes supply the only gray on the
    // board (`bg-home-panel` below), and a tint here is the double panel again.
    //
    // `items-start` stops lanes stretching: each is as tall as its contents and
    // vertical overflow belongs to this board, not a scrollbar per lane.
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
  /** `+ Lead` once named; `+ Untitled object` while the lane still is not. */
  const addLabel = col.name || NEW_COLUMN_NAME;
  return (
    // ⚠ Pending column takes its whole lane inert: header inputs, menu and add
    // button all address an id the server hasn't minted yet.
    //
    // ⚠ **THE LANE'S GRAY IS THE TAB-SWITCHER PANEL'S** (Samuel, 2026-09-11: *"I
    // want it to be the same gray that appears on the panel holding the tab
    // switcher"*) — `--home-panel`, which is what /home's header strip stands on
    // (`apps/desktop-ui/src/pages/home/index.tsx`, the `page-float bg-home-panel`
    // base panel). It was `bg-bg-inset`, four steps off it. ⚠ BY TOKEN, never a
    // hex, and the skeleton lane wears the same one (`ontology-skeleton.tsx`).
    <div
      {...pendingRow(
        pendingIds.has(col.id),
        "flex w-72 shrink-0 flex-col gap-2 self-start rounded-[14px] bg-home-panel p-3"
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
      {/* No scroller here: lane hugs its cards, the board scrolls. */}
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
          // Hugs the left corner AFTER the last card, not filling the lane:
          // it is the next row in the list, not a footer.
          //
          // ⚠ **THE LABEL IS THE OBJECT'S OWN NAME** (Samuel, 2026-09-11: *"Once
          // the user has named the object, it should say 'the bunch + name of the
          // object' … instead of '+ untitled columns'"*) — the button adds an ITEM
          // of this object type, so it reads `+ Lead`, and only an unnamed lane
          // falls back to the lane's born name (`NEW_COLUMN_NAME`, "Untitled
          // object"). It was a bare `Add`, which said nothing about what it made.
          // ⚠ `min-w-0` + `truncate` because the label is user text in a fixed
          // `w-72` lane: a long object name must ellipsise INSIDE the pill rather
          // than widen it past the lane it sits in.
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
      </div>
    </div>
  );
}
