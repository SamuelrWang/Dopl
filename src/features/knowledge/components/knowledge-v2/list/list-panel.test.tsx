import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { KnowledgeBase } from "../../../types";
import type { TreeHandlers } from "../use-knowledge-v2-controller";
import { ListPanel } from "./list-panel";

/**
 * P0-6 "dead controls visible at launch". This header shipped two buttons
 * with no `onClick` and no plan to get one: a "Knowledge ▾" title button
 * implying a menu that does not exist, and a "Filter" icon duplicating the
 * scope SegmentedControl three rows below it. Both are gone; the only control
 * left in the header is the one that works.
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

function render(bases: KnowledgeBase[] = [base()]) {
  return renderToStaticMarkup(
    <ListPanel
      bases={bases}
      currentUserId="u-me"
      query=""
      onQueryChange={() => {}}
      filter="all"
      onFilterChange={() => {}}
      selectedBaseId={null}
      selectedEntryId={null}
      expanded={new Set()}
      trees={{}}
      canEdit={() => true}
      editingNodeId={null}
      treeHandlers={noopTreeHandlers}
      onSelectBase={() => {}}
      onToggleExpand={() => {}}
      onSelectEntry={() => {}}
      onCreate={() => {}}
    />
  );
}

describe("knowledge ListPanel header", () => {
  it("no longer offers a dead Filter button", () => {
    expect(render()).not.toContain('aria-label="Filter"');
  });

  it("renders the pane title as a heading, not a menu-less button", () => {
    const html = render();
    expect(html).toContain("<h1");
    expect(html).toContain("Knowledge");
    // the ▾ that promised a dropdown is gone with the button
    expect(html).not.toContain("lucide-chevron-down");
  });

  it("keeps the one header control that works, and shows the base count", () => {
    const html = render([base(), base({ id: "kb-2", slug: "runbooks" })]);
    expect(html).toContain('aria-label="New knowledge base"');
    expect(html).toContain(">2<");
  });

  it("leaves the working scope filter in place below the search", () => {
    expect(render()).toContain('role="tablist"');
  });
});
