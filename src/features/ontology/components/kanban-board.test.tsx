// @vitest-environment jsdom
/**
 * THE LANE'S ADD BUTTON — **it is named for the object it adds to** (Samuel,
 * 2026-09-11: *"Once the user has named the object, it should say 'the bunch +
 * name of the object' … Instead of '+ untitled columns'"*).
 *
 * ⚠ WHAT IS PINNED IS THE **LABEL'S SOURCE**, not its text: the visible word is
 * the lane's own `name`, and the fallback is `NEW_COLUMN_NAME` — the SAME
 * constant a newly drafted lane is born with, imported here rather than
 * retyped, so a future rename of the born name cannot leave this button saying
 * something the board does not. The failure this is for is the button drifting
 * back to a generic verb ("Add"), which tells the operator nothing about what
 * the click makes, or to the board's private word ("column").
 *
 * ⚠ **THE ACCESSIBLE NAME IS PINNED BESIDE THE VISIBLE ONE**, because the pill
 * truncates: a lane is a fixed `w-72` and a long object name ellipsises inside
 * the button, so the only complete statement of what the control does is the
 * `aria-label` — and a screen reader that heard "Add" would be worse off than
 * the eye.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { GraphState } from "../graph-state";
import { NEW_COLUMN_NAME } from "../optimistic-create";
import type { OntologyCluster, OntologyObject } from "../types";
import { KanbanBoard } from "./kanban-board";

afterEach(cleanup);

function object(id: string, name: string, childIds: string[] = []): OntologyObject {
  return {
    id,
    name,
    subtitle: "",
    attributes: [],
    relationships: [],
    methods: [],
    childIds,
    template: [],
  };
}

/** One NAMED lane and one the operator has not named yet — the pair is the
 *  whole ruling, since the fallback only ever shows on the second. */
const CLUSTER: OntologyCluster = {
  id: "c1",
  slug: "pipeline",
  name: "Pipeline",
  purpose: "",
  columnIds: ["col-named", "col-unnamed"],
  layout: {},
};

const GRAPH: GraphState = {
  clusters: [CLUSTER],
  objects: {
    "col-named": object("col-named", "Lead"),
    "col-unnamed": object("col-unnamed", ""),
  },
} as GraphState;

function renderBoard(canEdit = true) {
  return render(
    <KanbanBoard
      cluster={CLUSTER}
      graph={GRAPH}
      dispatch={vi.fn()}
      selectedId={null}
      pendingIds={new Set()}
      canEdit={canEdit}
      onSelect={vi.fn()}
      onCreateObject={vi.fn()}
    />
  );
}

describe("the lane's add button is named for its object", () => {
  it("reads the object's name once the operator has given it one", () => {
    renderBoard();
    const button = screen.getByRole("button", { name: "Add Lead" });
    expect(button.textContent).toContain("Lead");
    // ⚠ NOT the old generic verb, and not the board's private word.
    expect(button.textContent).not.toBe("Add");
    expect(button.textContent?.toLowerCase()).not.toContain("column");
  });

  it("falls back to the lane's BORN name while it is still unnamed", () => {
    renderBoard();
    const button = screen.getByRole("button", { name: `Add ${NEW_COLUMN_NAME}` });
    expect(button.textContent).toContain(NEW_COLUMN_NAME);
    // The ruling's own words: an untitled lane is an OBJECT, never a column.
    expect(NEW_COLUMN_NAME).toBe("Untitled object");
  });

  it("truncates inside the pill rather than widening the lane", () => {
    renderBoard();
    const label = screen.getByText("Lead");
    expect(label.className).toContain("truncate");
    expect(label.className).toContain("min-w-0");
  });

  it("is not offered to a viewer", () => {
    renderBoard(false);
    expect(screen.queryByRole("button", { name: "Add Lead" })).toBeNull();
  });
});
