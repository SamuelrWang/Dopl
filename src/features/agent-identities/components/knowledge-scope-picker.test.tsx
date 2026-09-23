// @vitest-environment jsdom
/**
 * THE KNOWLEDGE PICKER — the tree, the implied subtree, and the payload a pick
 * becomes (2026-09-08, Samuel: *"right now, you can only select entire bases,
 * but I want to be able to specific folders or entries/files. also i dont think
 * a dropdown is the best way to do it"*).
 *
 * ⚠ **THE COMPONENT IS RENDERED DIRECTLY, NOT THROUGH THE EDITOR.** The editor's
 * own suites own the PAYLOAD and are already near the 500-line cap; what is
 * under test here is the SELECTION RULE, which the editor cannot exercise
 * without a whole dialog around it.
 *
 * ⚠ THE TREE READ IS MOCKED. `useKnowledgeTree` is a lazy keyed query and this
 * file is about what the picker does with a tree, never about how it gets one.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { TemplateKnowledgeRef } from "../client/types";
import { KnowledgeScopePicker } from "./knowledge-scope-picker";

const BASES = [
  { id: "kb-1", name: "Runbooks" },
  { id: "kb-2", name: "Specs" },
];

/** ⚠ THE TREE READ IS MOCKED — this file is about what the picker DOES with a
 *  tree, never about how it gets one. `./knowledge-tree-mock` holds the shape
 *  (kb-1: Deploys/ → Nightly/ → "Rollback", plus "Loose" at the base root);
 *  `vi.mock` is hoisted, so the factory imports rather than closes over it. */
vi.mock("@/features/knowledge/client/hooks", async () => ({
  useKnowledgeTree: (await import("./knowledge-tree-mock")).useKnowledgeTree,
}));

function mount(selected: TemplateKnowledgeRef[] = []) {
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

/** Expand down to `Nightly`. ⚠ THERE IS NOTHING TO OPEN SINCE 2026-09-22: the
 *  tree is rendered IN the form (Samuel), so a suite that clicked its way in is
 *  a suite pinning a control that no longer exists. */
function openTree() {
  fireEvent.click(screen.getByRole("button", { name: "Expand Runbooks" }));
  fireEvent.click(screen.getByRole("button", { name: "Expand Deploys" }));
  fireEvent.click(screen.getByRole("button", { name: "Expand Nightly" }));
}

const last = (fn: ReturnType<typeof vi.fn>) =>
  fn.mock.calls[fn.mock.calls.length - 1][0] as TemplateKnowledgeRef[];

afterEach(cleanup);

describe("the tree", () => {
  it("opens on the BASES and drills into folders and entries", () => {
    mount();
      // ⚠ Bases at the root, and nothing beneath them until asked — the read is
    // lazy, so an unexpanded base costs no request.
    expect(screen.getByRole("treeitem", { name: "Runbooks" })).toBeTruthy();
    expect(screen.getByRole("treeitem", { name: "Specs" })).toBeTruthy();
    expect(screen.queryByRole("treeitem", { name: "Deploys" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Expand Runbooks" }));
    expect(screen.getByRole("treeitem", { name: "Deploys" })).toBeTruthy();
    // A base-root entry is a sibling of the base's top-level folders.
    expect(screen.getByRole("treeitem", { name: "Loose" })).toBeTruthy();
    // …and a nested folder still needs its own expansion.
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
        // ⚠ THE DISPLAY PATH — base name first, `" / "`-joined.
        path: "Runbooks / Deploys / Nightly",
        // …and the base-relative address a `dopl_kb` call takes. Never the same
        // string: a base named "Ops / Legal" makes splitting one back into the
        // other silently wrong.
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

/**
 * 🔒 **A FOLDER MEANS ITS SUBTREE, AND THE SET HOLDS ONE ROW.** Checking a
 * folder does not check its children into the set — it makes them IMPLIED. An
 * expansion would be a SNAPSHOT, and an entry filed tomorrow would silently not
 * be attached.
 */
describe("the implied subtree", () => {
  const folderRef: TemplateKnowledgeRef = {
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
    // ⚠ THE ROW THAT OWNS THE ATTACHMENT IS THE ANCESTOR, so this one is not the
    // place you detach it. A click here must change nothing at all.
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
    // ⚠ Two rows where one suffices renders the same attachment twice in the
    // role block — and the redundant one survives when the operator later
    // unchecks the ancestor, silently keeping an attachment they removed.
    const nested: TemplateKnowledgeRef = {
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
    const otherBase: TemplateKnowledgeRef = {
      baseId: "kb-2",
      baseName: "Specs",
      scope: "base",
      path: "Specs",
    };
    const nested: TemplateKnowledgeRef = {
      baseId: "kb-1",
      baseName: "Runbooks",
      scope: "folder",
      folderId: "f-1",
      folderName: "Deploys",
      path: "Runbooks / Deploys",
      toolPath: "Deploys",
    };
    const onChange = mount([nested, otherBase]);
      fireEvent.click(screen.getByRole("button", { name: "Expand Runbooks" }));
    fireEvent.click(screen.getByRole("treeitem", { name: "Runbooks" }));
    const next = last(onChange);
    expect(next.map((r) => r.path).sort()).toEqual(["Runbooks", "Specs"]);
  });
});

describe("the chips", () => {
  it("labels each scope by its path and removes exactly the one clicked", () => {
    const base: TemplateKnowledgeRef = {
      baseId: "kb-1",
      baseName: "Runbooks",
      scope: "base",
      path: "Runbooks",
    };
    const folder: TemplateKnowledgeRef = {
      baseId: "kb-2",
      baseName: "Specs",
      scope: "folder",
      folderId: "f-9",
      folderName: "API",
      path: "Specs / API",
      toolPath: "API",
    };
    const onChange = mount([base, folder]);
    // ⚠ **BY THE CHIP'S OWN DETACH NAME, NOT BY TEXT (2026-09-22).** The tree
    // is rendered in the form now, so a whole-base chip and that base's tree ROW
    // carry the same words — `getByText("Runbooks")` matched both and proved
    // neither. The detach label is the chip's and the chip's alone.
    expect(screen.getByRole("button", { name: "Detach Runbooks" })).toBeTruthy();
    expect(screen.getByText("Specs / API")).toBeTruthy();
    // 🔒 THE IDENTITY IS THE SHAPE PLUS ITS OWN ID, never the base id — a
    // whole-base scope and a folder scope of that base share the base id, so
    // keying on it would make removing one chip remove the other.
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
    // ⚠ **THE SENTENCE STANDS IN FOR THE TREE, and there is no disabled Add to
    // assert on any more (2026-09-22).** An empty container renders NO tree at
    // all — a `role="tree"` with nothing in it is a control that looks live and
    // holds nothing, which is the same defect the disabled button was avoiding.
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
