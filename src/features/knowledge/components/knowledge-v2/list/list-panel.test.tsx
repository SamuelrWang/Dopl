// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { KnowledgeBase } from "../../../types";
import type { BaseTree } from "../types";
import type { TreeHandlers } from "../use-knowledge-v2-controller";
import { ListPanel } from "./list-panel";

/**
 * The folder rail. Two things pinned here:
 *
 *   - An ABSENCE: the rail is scoped to one base, so base rows, the base-list
 *     search, the scope pills and (since 2026-08-28) its own breadcrumb must not
 *     come back — the panel has one header and one crumb.
 *   - Another ABSENCE (Samuel, 2026-09-29): no hide/show toggle. The rail is
 *     sized by the drag bar instead (`./rail-resize-handle.test.tsx`).
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

describe("knowledge folder rail", () => {
  it("shows the opened base's tree, with no base rows around it", () => {
    renderRail();
    expect(screen.getByText("Cold outreach")).toBeTruthy();
    // no base-level disclosure: the rail holds exactly one base.
    expect(screen.queryByLabelText("Collapse")).toBeNull();
    expect(screen.queryByLabelText("Expand")).toBeNull();
  });

  it("carries NO breadcrumb — the panel's one header owns the address", () => {
    renderRail();
    expect(screen.queryByLabelText("Knowledge base breadcrumb")).toBeNull();
    // …and no title either: a heading made the column read as its own page.
    expect(document.querySelector("h1")).toBeNull();
  });

  it("drops the base-list search and the scope pills", () => {
    renderRail();
    // that field filtered the BASE LIST; content search lives in the header.
    expect(screen.queryByPlaceholderText("Search")).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("renders a skeleton, not an empty tree, before the fetch lands", () => {
    renderRail(null);
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-busy")).toBe("true");
    // …and not a text loader (docs/DESIGN-SYSTEM.md).
    expect(screen.getByText("Loading knowledge base").className).toContain(
      "sr-only"
    );
  });

  it("has NO hide/show toggle — the drag bar replaced it", () => {
    renderRail();
    expect(screen.queryByRole("button", { name: /^(Hide|Show) files$/ })).toBeNull();
    expect(document.querySelector("[aria-expanded]")).toBeNull();
    // …and no "Files" header above the tree (Samuel, 2026-09-29).
    expect(screen.queryByRole("heading", { name: "Files" })).toBeNull();
  });

  // the fill itself (hover == selected, one rule) is pinned in `../layout-rules.test.ts`.
  it("marks the selected row active", () => {
    render(
      <ListPanel
        base={base()}
        tree={READY}
        selectedEntryId="e-1"
        canEdit={false}
        editingNodeId={null}
        treeHandlers={noopTreeHandlers}
        onSelectEntry={() => {}}
      />
    );
    const row = screen.getByText("Cold outreach").closest('[role="button"]')!;
    expect(row.className).toContain("treeRowActive");
  });

  it("puts the create actions on the GLOBAL pill, not a local recipe", () => {
    renderRail();
    // `.btn-light` is the shared face `OpenScaleButton` composes.
    for (const name of ["New file", "New folder"]) {
      const btn = screen.getByRole("button", { name: new RegExp(name) });
      expect(btn.className).toContain("btn-light");
      expect(btn.className).toContain("openScale");
    }
  });

  // Samuel, 2026-09-29: no folder chevron — folders and files sit flush left,
  // and a click on the folder row still opens and closes it.
  it("draws no folder chevron; folder and file share the root indent", () => {
    const tree: BaseTree = {
      status: "ready",
      folders: [
        { id: "f-1", name: "Playbooks", parentId: null, position: 0 },
      ] as unknown as BaseTree["folders"],
      entries: [
        { id: "e-1", title: "Cold outreach", folderId: null, position: 0 },
        { id: "e-2", title: "Nested note", folderId: "f-1", position: 0 },
      ] as unknown as BaseTree["entries"],
    };
    renderRail(tree, false);
    expect(document.querySelector(".lucide-chevron-right")).toBeNull();
    expect(document.querySelector(".lucide-chevron-down")).toBeNull();
    expect(document.querySelector('[class*="treeChevron"]')).toBeNull();

    const folderRow = screen.getByText("Playbooks").closest<HTMLElement>('[role="button"]')!;
    const fileRow = screen.getByText("Cold outreach").closest<HTMLElement>('[role="button"]')!;
    expect(folderRow.style.paddingLeft).toBe(fileRow.style.paddingLeft);
    // the icon is the row's first child: nothing reserved ahead of it.
    expect(folderRow.firstElementChild?.getAttribute("class")).toContain("lucide-folder");
    expect(fileRow.firstElementChild?.getAttribute("class")).toContain("lucide-file-text");

    // toggle still works: closed → open (FolderOpen, child visible) → closed.
    expect(screen.queryByText("Nested note")).toBeNull();
    fireEvent.click(folderRow);
    expect(screen.getByText("Nested note")).toBeTruthy();
    expect(folderRow.firstElementChild?.getAttribute("class")).toContain("lucide-folder-open");
    const nestedRow = screen.getByText("Nested note").closest<HTMLElement>('[role="button"]')!;
    expect(parseFloat(nestedRow.style.paddingLeft)).toBeGreaterThan(
      parseFloat(fileRow.style.paddingLeft)
    );
    fireEvent.click(folderRow);
    expect(screen.queryByText("Nested note")).toBeNull();
  });

  it("offers no create actions to a viewer", () => {
    renderRail(READY, false);
    expect(screen.queryByRole("button", { name: /New file/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /New folder/ })).toBeNull();
  });
});
