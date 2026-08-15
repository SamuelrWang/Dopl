import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { KnowledgeBase } from "../../../types";
import type { BaseTree } from "../types";
import type { TreeHandlers } from "../use-knowledge-v2-controller";
import { ListPanel } from "./list-panel";

/**
 * Base-detail list pane. Pins an ABSENCE: the pane is scoped to ONE base, so
 * base rows, the base-list search field and the scope pills must not come
 * back. Plus P0-6 (a visible control does something): the crumb is the pane's
 * only button and it navigates.
 */

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

function render(tree: BaseTree | null = READY) {
  return renderToStaticMarkup(
    <ListPanel
      base={base()}
      tree={tree ?? undefined}
      selectedEntryId={null}
      canEdit
      editingNodeId={null}
      treeHandlers={noopTreeHandlers}
      onSelectEntry={() => {}}
      onGoHome={() => {}}
    />
  );
}

describe("knowledge base-detail list pane", () => {
  it("leads with a Knowledge › {base} breadcrumb, not a pane title", () => {
    const html = render();
    expect(html).toContain('aria-label="Knowledge base breadcrumb"');
    expect(html).toContain("Knowledge");
    expect(html).toContain("Product specs");
    // A title makes the pane read as its own page; the base name already
    // heads the DETAIL pane.
    expect(html).not.toContain("<h1");
  });

  it("shows the opened base's tree expanded, with no base rows around it", () => {
    const html = render();
    expect(html).toContain("Cold outreach");
    // A disclosure chevron is meaningless with exactly one base.
    expect(html).not.toContain('aria-label="Collapse"');
    expect(html).not.toContain('aria-label="Expand"');
  });

  it("drops the base-list search and the scope pills", () => {
    const html = render();
    // That field filtered the BASE LIST; content search lives in the detail
    // pane's top bar.
    expect(html).not.toContain('placeholder="Search"');
    expect(html).not.toContain('role="tablist"');
  });

  it("renders a skeleton, not an empty tree, before the fetch lands", () => {
    const html = render(null);
    expect(html).toContain('role="status"');
    expect(html).toContain("Loading knowledge base");
    // …and NOT a text loader (docs/DESIGN-SYSTEM.md).
    expect(html).toContain("sr-only");
  });
});
