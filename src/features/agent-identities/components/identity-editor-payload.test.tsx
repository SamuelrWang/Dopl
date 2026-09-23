// @vitest-environment jsdom
/**
 * ⚠ **ITS OWN FILE SINCE 2026-09-08, AND THE REASON IS §1's 500-LINE CAP.**
 * `identity-editor.test.tsx` crossed it when the knowledge picker's tree mock
 * landed beside these cases (`eslint.config.mjs › max-lines`, `error`, no
 * exemption for this path). It is the same seam that file has already been cut
 * on twice — the SOURCE-READ half went to `identity-editor-surface.test.tsx` and
 * the attachment half to `identity-editor-knowledge.test.tsx`. What is here is
 * the PAYLOAD, whole; the fixture and the `open()` helper are local and
 * deliberately minimal, because a suite importing another's harness couples two
 * files that were split to be independent.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { draftToCreateBody, draftToPatchBody } from "../lib/identity-draft";
import {
  CREATE_VERB,
  addField,
  field,
  filledIdentity,
  open,
  pick,
  press,
} from "./identity-editor-harness";

/** ⚠ THE PICKER READS A TREE PER BASE. Shape in `./knowledge-tree-mock`; the
 *  factory imports it because `vi.mock` is hoisted above every binding. */
vi.mock("@/features/knowledge/client/hooks", async () => ({
  useKnowledgeTree: (await import("./knowledge-tree-mock")).useKnowledgeTree,
}));

/** The desktop's registered runtimes and Claude's live roster — the Model row
 *  offers the IDENTITY'S runtime's models, so a runtime is picked first. */
vi.mock("@/features/channels/hooks/use-launch-selection", async () => {
  const { catalog, launchSelectionStub } = await import(
    "@/features/channels/hooks/launch-selection-harness"
  );
  const { REAL_DEFAULT_RUNTIME, REAL_DESCRIPTORS } = await import(
    "@/features/channels/lib/runtime-descriptors-harness"
  );
  const claude = catalog("claude", [
    { id: "claude-fable-5", label: "Fable 5" },
    { id: "claude-opus-5", label: "Opus 5" },
    { id: "claude-sonnet-5", label: "Sonnet 5", isDefault: true },
    { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
  ]);
  return {
    useLaunchSelection: () =>
      launchSelectionStub({
        runtimeSupported: true,
        runtimes: REAL_DESCRIPTORS,
        defaultRuntime: REAL_DEFAULT_RUNTIME,
        catalogs: { claude },
      }),
  };
});

afterEach(cleanup);

/**
 * 🔒 **THE PAYLOAD IS THE PRE-KIT EDITOR'S, FIELD FOR FIELD** (2026-09-08, the
 * popup-form conversion). Written and green BEFORE the markup moved onto
 * `shared/ui/form-dialog.tsx`, so the literals below are a snapshot of what the
 * `StandardDialog`/`RAISED_INPUT` editor sent — not a restatement of what the
 * new one happens to send. The two helpers above ({@link pickModel},
 * {@link pickScope}) are the ONLY things the conversion was allowed to touch:
 * a face change that reaches `draftToCreateBody` / `draftToPatchBody` fails
 * here, which is the whole point of pinning it first.
 */
describe("the payload survives the face", () => {
  it("CREATE — every control the editor has, in ONE body", async () => {
    const { draft } = await open();
    fireEvent.change(field("#agent-identity-name"), { target: { value: "  Scout  " } });
    fireEvent.change(field("#agent-identity-description"), {
      target: { value: "  Finds things  " },
    });
    fireEvent.change(field("#agent-identity-instructions"), {
      target: { value: "  Search first.  " },
    });
    pick("Runtime", "Claude Code");
    pick("Model", "Opus 5");
    pick("Visibility", "Public");
    addField("repo", "dopl");
    // ⚠ NO ADD BUTTON TO PRESS SINCE 2026-09-22 — the tree is in the form, so
    // the base is checked where it is listed (Samuel).
    fireEvent.click(screen.getByRole("treeitem", { name: "Specs" }));
    press(CREATE_VERB);

    expect(draftToCreateBody(draft())).toEqual({
      name: "Scout",
      visibility: "workspace",
      description: "Finds things",
      instructions: "Search first.",
      model: "claude-opus-5",
      runtime: "claude",
      fields: [{ key: "repo", value: "dopl" }],
      knowledge: [{ baseId: "kb-2", scope: "base" }],
    });
  });

  it("EDIT — the PATCH is the CHANGED keys and nothing else", async () => {
    const stored = filledIdentity({ runtime: "claude" });
    const { draft } = await open({ identity: stored });
    fireEvent.change(field("#agent-identity-name"), { target: { value: "Release captain v2" } });
    fireEvent.change(field("#agent-identity-description"), { target: { value: "" } });
    pick("Model", "Haiku 4.5");
    press("Detach Runbooks");
    press("Save");

    expect(draftToPatchBody(draft(), stored)).toEqual({
      name: "Release captain v2",
      description: null,
      model: "claude-haiku-4-5-20251001",
      knowledge: [],
    });
  });
});
