// @vitest-environment jsdom
// The whole save payload with a desktop present; `identity-editor.test.tsx` runs the editor with
// no bridge.

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

// The form renders the knowledge tree; the factory imports the fake because `vi.mock` is hoisted.
vi.mock("@/features/knowledge/client/hooks", async () => ({
  useKnowledgeTree: (await import("./knowledge-tree-mock")).useKnowledgeTree,
}));

// Real runtime descriptors plus Claude's live catalog: the Model row lists the identity runtime's models.
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

// The literals are a fixed snapshot of the wire body: a face change that reaches
// `draftToCreateBody` / `draftToPatchBody` fails here.
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
