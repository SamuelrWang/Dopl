// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { KnowledgeBase } from "../../../types";
import type { BaseTree } from "../types";
import type { TreeHandlers } from "../use-knowledge-v2-controller";
import { ListPanel } from "./list-panel";

/**
 * THE FOLDER RAIL. Two things to pin, and they are different in kind:
 *
 *   - AN ABSENCE. The rail is scoped to ONE base, so base rows, the base-list
 *     search and the scope pills must not come back — and since 2026-08-28 its
 *     own BREADCRUMB must not either: the panel has one header and one crumb
 *     (`../detail/base-header.tsx`), which is what killed the two-navs-one-name
 *     ambiguity this file used to work around.
 *   - THE COLLAPSE. It is the ruling's mechanic: a STRIP, not a disappearance,
 *     so the control that reopens it is still in the column it belongs to.
 *
 * ⚠ CLASS ASSERTIONS ARE REAL HERE. `test.css` is off, so a CSS-module lookup
 * returns its own key — `styles.railCollapsed` renders as `railCollapsed`. The
 * assertion is that the COLLAPSED MODIFIER is applied, not that a stylesheet
 * said something; the width, the 150ms and the reduced-motion opt-out live in
 * `../knowledge-v2.module.css › .rail` and are not jsdom's to answer.
 */

afterEach(cleanup);

const noopTreeHandlers = {} as TreeHandlers;

function base(over: Partial<KnowledgeBase> = {}): KnowledgeBase {
  return {
    id: "kb-1",
    slug: "specs",
    name: "Product specs",
    description: null,
    visibility: "private",
    accessMode: "workspace",
    createdBy: "u-me",
    ...over,
  } as KnowledgeBase;
}

const READY: BaseTree = {
  status: "ready",
  folders: [],
  entries: [
    { id: "e-1", title: "Cold outreach", folderId: null, position: 0 },
  ] as unknown as BaseTree["entries"],
};

function renderRail(tree: BaseTree | null = READY, canEdit = true) {
  return render(
    <ListPanel
      base={base()}
      tree={tree ?? undefined}
      selectedEntryId={null}
      canEdit={canEdit}
      editingNodeId={null}
      treeHandlers={noopTreeHandlers}
      onSelectEntry={() => {}}
    />
  );
}

/** The rail's own element — the collapse modifier's host. ⚠ Reached through
 *  the toggle under EITHER name: the point of the strip mechanic is that the
 *  control survives the collapse, so the lookup must not assume one label. */
const railEl = () =>
  screen.getByRole("button", { name: /^(Hide|Show) files$/ }).parentElement!;

describe("knowledge folder rail", () => {
  it("shows the opened base's tree, with no base rows around it", () => {
    renderRail();
    expect(screen.getByText("Cold outreach")).toBeTruthy();
    // A disclosure chevron is meaningless with exactly one base.
    expect(screen.queryByLabelText("Collapse")).toBeNull();
    expect(screen.queryByLabelText("Expand")).toBeNull();
  });

  it("carries NO breadcrumb — the panel's one header owns the address", () => {
    renderRail();
    expect(screen.queryByLabelText("Knowledge base breadcrumb")).toBeNull();
    // …and no title either: a heading here made the column read as its own page.
    expect(document.querySelector("h1")).toBeNull();
  });

  it("drops the base-list search and the scope pills", () => {
    renderRail();
    // That field filtered the BASE LIST; content search lives in the header.
    expect(screen.queryByPlaceholderText("Search")).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("renders a skeleton, not an empty tree, before the fetch lands", () => {
    renderRail(null);
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-busy")).toBe("true");
    // …and NOT a text loader (docs/DESIGN-SYSTEM.md).
    expect(screen.getByText("Loading knowledge base").className).toContain(
      "sr-only"
    );
  });

  it("collapses to a strip and back, keeping its own toggle both ways", () => {
    renderRail();
    const toggle = screen.getByRole("button", { name: "Hide files" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(railEl().className).not.toContain("railCollapsed");

    fireEvent.click(toggle);

    // 🔒 THE MECHANIC: the toggle is still there, under its other name — a
    // rail that vanished whole would have to grow a second control somewhere
    // that does not name the tree.
    const reopen = screen.getByRole("button", { name: "Show files" });
    expect(reopen.getAttribute("aria-expanded")).toBe("false");
    expect(railEl().className).toContain("railCollapsed");

    fireEvent.click(reopen);
    expect(screen.getByRole("button", { name: "Hide files" })).toBeTruthy();
    expect(railEl().className).not.toContain("railCollapsed");
  });

  it("puts the create actions on the GLOBAL pill, not a local recipe", () => {
    renderRail();
    // `.btn-light` is the shared face `OpenScaleButton` composes; the deleted
    // `.addBtn` painted nothing but a hover tint.
    for (const name of ["New file", "New folder"]) {
      const btn = screen.getByRole("button", { name: new RegExp(name) });
      expect(btn.className).toContain("btn-light");
      expect(btn.className).toContain("openScale");
    }
  });

  it("offers no create actions to a viewer", () => {
    renderRail(READY, false);
    expect(screen.queryByRole("button", { name: /New file/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /New folder/ })).toBeNull();
  });
});
