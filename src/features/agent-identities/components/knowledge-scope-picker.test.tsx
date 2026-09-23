// @vitest-environment jsdom
// The picker rendered directly: the selection rule (tree, implied subtree, the ref a pick
// becomes). The editor suites own the save payload.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { IdentityKnowledgeRef } from "../client/types";
import { KnowledgeScopePicker } from "./knowledge-scope-picker";

const BASES = [
  { id: "kb-1", name: "Runbooks" },
  { id: "kb-2", name: "Specs" },
];

// kb-1: Deploys/ → Nightly/ → "Rollback", plus "Loose" at the base root (`./knowledge-tree-mock`);
// the factory imports it because `vi.mock` is hoisted.
vi.mock("@/features/knowledge/client/hooks", async () => ({
  useKnowledgeTree: (await import("./knowledge-tree-mock")).useKnowledgeTree,
}));

function mount(selected: IdentityKnowledgeRef[] = []) {
  const onChange = vi.fn();
  render(
    <KnowledgeScopePicker
      workspaceId="ws-1"
      bases={BASES}
      selected={selected}
      onChange={onChange}
      emptyLine="No knowledge here yet."
    />
  );
  return onChange;
}

/** Expand down to `Nightly`. */
function openTree() {
  fireEvent.click(screen.getByRole("button", { name: "Expand Runbooks" }));
  fireEvent.click(screen.getByRole("button", { name: "Expand Deploys" }));
  fireEvent.click(screen.getByRole("button", { name: "Expand Nightly" }));
}

const last = (fn: ReturnType<typeof vi.fn>) =>
  fn.mock.calls[fn.mock.calls.length - 1][0] as IdentityKnowledgeRef[];

afterEach(cleanup);

describe("the tree", () => {
  it("opens on the BASES and drills into folders and entries", () => {
    mount();
    // Nothing beneath a base until it is expanded: the read is lazy.
    expect(screen.getByRole("treeitem", { name: "Runbooks" })).toBeTruthy();
    expect(screen.getByRole("treeitem", { name: "Specs" })).toBeTruthy();
    expect(screen.queryByRole("treeitem", { name: "Deploys" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Expand Runbooks" }));
    expect(screen.getByRole("treeitem", { name: "Deploys" })).toBeTruthy();
    // A base-root entry is a sibling of the base's top-level folders.
    expect(screen.getByRole("treeitem", { name: "Loose" })).toBeTruthy();
    expect(screen.queryByRole("treeitem", { name: "Nightly" })).toBeNull();
  });

  it("picks a FOLDER as one scope, with the whole chain in its path", () => {
    const onChange = mount();
    openTree();
    fireEvent.click(screen.getByRole("treeitem", { name: "Nightly" }));
    expect(last(onChange)).toEqual([
      {
        baseId: "kb-1",
        baseName: "Runbooks",
        scope: "folder",
        folderId: "f-2",
        folderName: "Nightly",
        path: "Runbooks / Deploys / Nightly",
        // The base-relative `dopl_kb` address, never derived from `path`: a base named
        // "Ops / Legal" breaks a split.
        toolPath: "Deploys/Nightly",
      },
    ]);
  });

  it("picks an ENTRY at its folder's path", () => {
    const onChange = mount();
    openTree();
    fireEvent.click(screen.getByRole("treeitem", { name: "Rollback" }));
    expect(last(onChange)[0]).toMatchObject({
      scope: "entry",
      entryId: "e-1",
      path: "Runbooks / Deploys / Nightly / Rollback",
      toolPath: "Deploys/Nightly/Rollback",
    });
  });
});

// A folder means its live subtree and the set holds one row; expanding it into children would be a
// snapshot that misses an entry filed tomorrow.
describe("the implied subtree", () => {
  const folderRef: IdentityKnowledgeRef = {
    baseId: "kb-1",
    baseName: "Runbooks",
    scope: "folder",
    folderId: "f-1",
    folderName: "Deploys",
    path: "Runbooks / Deploys",
    toolPath: "Deploys",
  };

  it("renders descendants checked and REFUSES to toggle them", () => {
    const onChange = mount([folderRef]);
    openTree();
    const nested = screen.getByRole("treeitem", { name: "Nightly" });
    const entry = screen.getByRole("treeitem", { name: "Rollback" });
    expect(nested.getAttribute("aria-selected")).toBe("true");
    expect(nested.getAttribute("aria-disabled")).toBe("true");
    expect(entry.getAttribute("aria-selected")).toBe("true");
    // The ancestor owns the attachment, so a click on a descendant changes nothing.
    fireEvent.click(nested);
    fireEvent.click(entry);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does NOT imply a sibling outside the folder", () => {
    mount([folderRef]);
    fireEvent.click(screen.getByRole("button", { name: "Expand Runbooks" }));
    // "Loose" sits at the base root, not under Deploys.
    expect(
      screen.getByRole("treeitem", { name: "Loose" }).getAttribute("aria-selected")
    ).toBe("false");
  });

  it("PRUNES the scopes a newly checked ancestor now covers", () => {
    // A redundant row would survive unchecking the ancestor, keeping an attachment the operator removed.
    const nested: IdentityKnowledgeRef = {
      baseId: "kb-1",
      baseName: "Runbooks",
      scope: "entry",
      entryId: "e-1",
      entryTitle: "Rollback",
      path: "Runbooks / Deploys / Nightly / Rollback",
      toolPath: "Deploys/Nightly/Rollback",
    };
    const onChange = mount([nested]);
    openTree();
    fireEvent.click(screen.getByRole("treeitem", { name: "Deploys" }));
    const next = last(onChange);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ scope: "folder", folderId: "f-1" });
  });

  it("checking a BASE prunes every scope of that base and leaves other bases alone", () => {
    const otherBase: IdentityKnowledgeRef = {
      baseId: "kb-2",
      baseName: "Specs",
      scope: "base",
      path: "Specs",
    };
    const onChange = mount([folderRef, otherBase]);
    fireEvent.click(screen.getByRole("button", { name: "Expand Runbooks" }));
    fireEvent.click(screen.getByRole("treeitem", { name: "Runbooks" }));
    const next = last(onChange);
    expect(next.map((r) => r.path).sort()).toEqual(["Runbooks", "Specs"]);
  });

  it("prunes the base's scopes when the base is checked COLLAPSED — the tree is unread", () => {
    const otherEntry: IdentityKnowledgeRef = {
      baseId: "kb-2",
      baseName: "Specs",
      scope: "entry",
      entryId: "e-9",
      entryTitle: "API",
      path: "Specs / API",
      toolPath: "API.md",
    };
    const onChange = mount([folderRef, otherEntry]);
    fireEvent.click(screen.getByRole("treeitem", { name: "Runbooks" }));
    expect(last(onChange).map((r) => r.path).sort()).toEqual(["Runbooks", "Specs / API"]);
  });
});

describe("the chips", () => {
  it("labels each scope by its path and removes exactly the one clicked", () => {
    const base: IdentityKnowledgeRef = {
      baseId: "kb-1",
      baseName: "Runbooks",
      scope: "base",
      path: "Runbooks",
    };
    const folder: IdentityKnowledgeRef = {
      baseId: "kb-2",
      baseName: "Specs",
      scope: "folder",
      folderId: "f-9",
      folderName: "API",
      path: "Specs / API",
      toolPath: "API",
    };
    const onChange = mount([base, folder]);
    // By the chip's detach name: the base's tree row carries the same text.
    expect(screen.getByRole("button", { name: "Detach Runbooks" })).toBeTruthy();
    expect(screen.getByText("Specs / API")).toBeTruthy();
    // A chip is keyed by shape + own id, never the base id, which a base scope and its folder scope share.
    fireEvent.click(screen.getByRole("button", { name: "Detach Specs / API" }));
    expect(last(onChange)).toEqual([base]);
  });

  it("says so, and renders no tree, when the container holds no knowledge", () => {
    render(
      <KnowledgeScopePicker
        workspaceId="ws-1"
        bases={[]}
        selected={[]}
        onChange={vi.fn()}
        emptyLine="No knowledge here yet."
      />
    );
    expect(screen.getByText("No knowledge here yet.")).toBeTruthy();
    // An empty `role="tree"` would be a control that looks live and holds nothing.
    expect(screen.queryByRole("tree")).toBeNull();
  });
});

describe("the keyboard", () => {
  it("moves focus with the arrows and toggles with Space", () => {
    const onChange = mount();
    const rows = screen.getAllByRole("treeitem");
    rows[0].focus();
    fireEvent.keyDown(screen.getByRole("tree"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(rows[1], { key: " " });
    expect(last(onChange)[0]).toMatchObject({ baseId: "kb-2", scope: "base" });
  });

  it("expands and collapses with ArrowRight / ArrowLeft", () => {
    mount();
    const base = screen.getByRole("treeitem", { name: "Runbooks" });
    fireEvent.keyDown(base, { key: "ArrowRight" });
    expect(screen.getByRole("treeitem", { name: "Deploys" })).toBeTruthy();
    fireEvent.keyDown(base, { key: "ArrowLeft" });
    expect(screen.queryByRole("treeitem", { name: "Deploys" })).toBeNull();
  });
});
