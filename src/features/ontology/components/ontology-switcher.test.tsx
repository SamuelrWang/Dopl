// @vitest-environment jsdom
/**
 * The cluster picker — the ontology's name as the trigger, every ontology and the
 * create behind it (Samuel, 2026-09-10). Pins source and shape: one control on two
 * boards, against a board showing a different set, the trigger returning as a pill,
 * or the create row going missing.
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

/** One cluster of a column and two cards (three objects, one column) plus one empty
 *  cluster — the pair that keeps the count honest (R5, a graph walk). */
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

describe("the list source", () => {
  it("carries the graph WALK, one entry per cluster", () => {
    // R5: an object can sit in several clusters, so the count is a walk — one
    // column plus its two cards is three, never `columnIds.length`.
    expect(clusterSwitcherEntries(GRAPH)).toEqual([
      { id: "c1", name: "Pipeline", objectCount: 3 },
      { id: "c2", name: "Roster", objectCount: 0 },
    ]);
  });
});

function renderSwitcher(
  props: {
    onSelect?: () => void;
    onCreate?: () => void;
    canEdit?: boolean;
  } = {}
) {
  const onSelect = props.onSelect ?? vi.fn();
  const onCreate = props.onCreate ?? vi.fn();
  render(
    <ClusterSwitcher
      entries={clusterSwitcherEntries(GRAPH)}
      activeId="c1"
      canEdit={props.canEdit}
      onSelect={onSelect}
      onCreate={onCreate}
    />
  );
  return { onSelect, onCreate };
}

describe("the trigger", () => {
  it("is the NAME and a chevron — no pill, no count, not bold", () => {
    renderSwitcher();
    const trigger = screen.getByTitle("Switch ontology");

    // plain `textContent`: the root vitest setup loads no jest-dom matchers.
    expect(trigger.textContent).toBe("Pipeline");
    // no pill and no bold weight (Samuel, 2026-09-10).
    expect(trigger.className).not.toMatch(/raised-tab|rounded-full|seg-pill/);
    // it wears the channel row's name recipe (`relationship-list.tsx`).
    expect(trigger.className).toMatch(/\btext-body\b/);
    expect(trigger.className).toMatch(/\bfont-medium\b/);
    expect(trigger.className).not.toMatch(/text-title|font-semibold|font-bold/);
    expect(trigger.querySelector("svg")).toBeTruthy();
    // a dropdown, not tabs — the other ontology is behind it, never beside it.
    expect(screen.queryByText("Roster")).toBeNull();
  });
});

describe("the menu", () => {
  it("lists EVERY cluster, marks the current one, and selects", () => {
    const { onSelect } = renderSwitcher({ canEdit: true });
    fireEvent.click(screen.getByTitle("Switch ontology"));

    const menu = screen.getByRole("menu");
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Pipeline3 objects",
      "Roster0 objects",
      "Ontology",
    ]);

    fireEvent.click(items[1]);
    expect(onSelect).toHaveBeenCalledWith("c2");
    // the menu closes on the pick.
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("does not re-select the ontology already open", () => {
    const { onSelect } = renderSwitcher();
    fireEvent.click(screen.getByTitle("Switch ontology"));
    fireEvent.click(within(screen.getByRole("menu")).getAllByRole("menuitem")[0]);

    expect(onSelect).not.toHaveBeenCalled();
  });

  it("ends with the CREATE row, which is a menu option and not a page button", () => {
    const { onCreate } = renderSwitcher({ canEdit: true });
    fireEvent.click(screen.getByTitle("Switch ontology"));

    const create = screen.getByRole("menuitem", { name: "Ontology" });
    // Samuel, 2026-09-10: a gray option row, not a black button — the shared
    // `.menu-row`, never `auth-btn-3d`.
    expect(create.className).toMatch(/menu-row/);
    expect(create.className).not.toMatch(/auth-btn-3d/);
    expect(create.querySelector("svg")).toBeTruthy();

    fireEvent.click(create);
    expect(onCreate).toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("hides the create row from a VIEWER, keeping the list", () => {
    renderSwitcher();
    fireEvent.click(screen.getByTitle("Switch ontology"));

    expect(screen.queryByRole("menuitem", { name: "Ontology" })).toBeNull();
    expect(screen.getAllByRole("menuitem")).toHaveLength(2);
  });
});
