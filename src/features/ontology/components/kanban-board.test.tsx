// @vitest-environment jsdom
/**
 * The lane's add button is named for the object it adds to (Samuel, 2026-09-11).
 *
 * What is pinned is the label's SOURCE, not its text: the lane's own `name`, with
 * `NEW_COLUMN_NAME` imported rather than retyped so a rename of the born name
 * cannot leave this button saying what the board does not.
 *
 * The accessible name is pinned beside the visible one because the pill truncates
 * inside a fixed `w-72` lane — the `aria-label` is the only complete statement.
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

/** One named lane and one still unnamed — the fallback only shows on the second. */
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
    // not the old generic verb, and not the board's private word.
    expect(button.textContent).not.toBe("Add");
    expect(button.textContent?.toLowerCase()).not.toContain("column");
  });

  it("falls back to the lane's BORN name while it is still unnamed", () => {
    renderBoard();
    const button = screen.getByRole("button", { name: `Add ${NEW_COLUMN_NAME}` });
    expect(button.textContent).toContain(NEW_COLUMN_NAME);
    // an untitled lane is an object, never a column.
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
