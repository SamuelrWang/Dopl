// @vitest-environment jsdom
/**
 * THE CLUSTER PICKER'S TWO FACES — one list source, two renders (2026-09-10).
 *
 * ⚠ WHAT IS WORTH PINNING HERE IS THE **SOURCE**, not the markup: the strip and
 * the dropdown are the same control on two pages, and the failure this file is
 * for is one of them quietly showing a different set of ontologies, or the same
 * number under a different word.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { GraphState } from "../graph-state";
import { ClusterSwitcher, clusterSwitcherEntries } from "./cluster-switcher";

afterEach(cleanup);

function object(id: string, name: string, childIds: string[] = []) {
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

/** One cluster of a column and two cards (THREE objects, ONE column), and one
 *  empty cluster — the pair that separates the two numbers. */
const GRAPH = {
  clusters: [
    {
      id: "c1",
      slug: "pipeline",
      name: "Pipeline",
      purpose: "",
      columnIds: ["col-1"],
      layout: {},
    },
    { id: "c2", slug: "roster", name: "Roster", purpose: "", columnIds: [], layout: {} },
  ],
  objects: {
    "col-1": object("col-1", "Stage", ["card-1", "card-2"]),
    "card-1": object("card-1", "Acme"),
    "card-2": object("card-2", "Globex"),
  },
} as unknown as GraphState;

const NONE: ReadonlySet<string> = new Set();

describe("the list source", () => {
  it("carries the graph WALK and the column count as SEPARATE numbers", () => {
    // ⚠ R5: an object can sit in several clusters, so "how many objects" is a
    // walk. The strip's bare number has always been the COLUMN count, and the
    // dropdown says the word "objects" out loud — one entry, both numbers, so
    // neither face can render one under the other's name.
    expect(clusterSwitcherEntries(GRAPH)).toEqual([
      { id: "c1", name: "Pipeline", objectCount: 3, columnCount: 1 },
      { id: "c2", name: "Roster", objectCount: 0, columnCount: 0 },
    ]);
  });
});

describe("the dropdown", () => {
  function renderDropdown(onSelect = vi.fn()) {
    render(
      <ClusterSwitcher
        mode="dropdown"
        entries={clusterSwitcherEntries(GRAPH)}
        activeId="c1"
        pendingIds={NONE}
        onSelect={onSelect}
      />
    );
    return onSelect;
  }

  it("shows ONE trigger — the current ontology and its object count", () => {
    renderDropdown();
    const trigger = screen.getByTitle("Switch ontology");

    // ⚠ Plain `textContent`: the root vitest setup loads no jest-dom matchers.
    expect(trigger.textContent).toBe("Pipeline3");
    // 🔒 A DROPDOWN, NOT TABS (Samuel, 2026-09-10) — the other ontology is
    // behind the trigger, never beside it.
    expect(screen.queryByText("Roster")).toBeNull();
  });

  it("lists EVERY cluster, marks the current one, and selects", () => {
    const onSelect = renderDropdown();
    fireEvent.click(screen.getByTitle("Switch ontology"));

    const menu = screen.getByRole("menu");
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Pipeline3 objects",
      "Roster0 objects",
    ]);

    fireEvent.click(items[1]);
    expect(onSelect).toHaveBeenCalledWith("c2");
    // The menu closes on the pick — a picker left open over the board it just
    // changed reads as a control that did nothing.
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("does not re-select the ontology already open", () => {
    const onSelect = renderDropdown();
    fireEvent.click(screen.getByTitle("Switch ontology"));
    fireEvent.click(within(screen.getByRole("menu")).getAllByRole("menuitem")[0]);

    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("the strip", () => {
  it("is UNCHANGED — one pill per cluster, the COLUMN count, and the create", () => {
    const onSelect = vi.fn();
    const onCreate = vi.fn();
    render(
      <ClusterSwitcher
        mode="pills"
        entries={clusterSwitcherEntries(GRAPH)}
        activeId="c1"
        pendingIds={NONE}
        canEdit
        onSelect={onSelect}
        onCreate={onCreate}
      />
    );

    expect(screen.getByRole("button", { name: "Pipeline1" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Roster0" }));
    expect(onSelect).toHaveBeenCalledWith("c2");

    fireEvent.click(screen.getByRole("button", { name: "New cluster" }));
    expect(onCreate).toHaveBeenCalled();
  });

  it("hides the create from a VIEWER", () => {
    render(
      <ClusterSwitcher
        mode="pills"
        entries={clusterSwitcherEntries(GRAPH)}
        activeId="c1"
        pendingIds={NONE}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
      />
    );

    expect(screen.queryByRole("button", { name: "New cluster" })).toBeNull();
  });
});
