// @vitest-environment jsdom
/**
 * The identity editor's Runtime and Model rows (rulings 4–6; F11, P7-12, X-03):
 * the Model row offers the IDENTITY's runtime's live models and nobody else's.
 * Before, it offered the registry default's (Claude's) catalog whatever the
 * operator meant, and a plain browser fell back to Claude's frozen four.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { draftToCreateBody, draftToPatchBody } from "../lib/identity-draft";
import { field, identity, open, pick, press, row, tabLabels } from "./identity-editor-harness";

vi.mock("@/features/knowledge/client/hooks", async () => ({
  useKnowledgeTree: (await import("./knowledge-tree-mock")).useKnowledgeTree,
}));

const desktop = vi.hoisted(() => ({ present: true }));
vi.mock("@/features/channels/hooks/use-launch-selection", async () => {
  const { catalog, launchSelectionStub } = await import(
    "@/features/channels/hooks/launch-selection-harness"
  );
  const { REAL_DEFAULT_RUNTIME, REAL_DESCRIPTORS } = await import(
    "@/features/channels/lib/runtime-descriptors-harness"
  );
  const catalogs = {
    claude: catalog("claude", [
      { id: "claude-opus-5", label: "Opus 5" },
      { id: "claude-sonnet-5", label: "Sonnet 5", isDefault: true },
    ]),
    codex: catalog("codex", [
      { id: "gpt-6-sol", label: "GPT-6 Sol", isDefault: true },
      { id: "gpt-6-luna", label: "GPT-6 Luna" },
    ]),
  };
  return {
    useLaunchSelection: () =>
      desktop.present
        ? launchSelectionStub({
            runtimeSupported: true,
            runtimes: REAL_DESCRIPTORS,
            defaultRuntime: REAL_DEFAULT_RUNTIME,
            catalogs,
          })
        : launchSelectionStub(),
  };
});

beforeEach(() => {
  desktop.present = true;
});
afterEach(cleanup);

describe("the Model row is the identity runtime's roster", () => {
  it("offers only Default while no runtime is chosen — no borrowed catalog", async () => {
    await open();
    expect(tabLabels("Runtime")).toEqual(["Any", "Claude Code", "Codex", "Cursor"]);
    expect(tabLabels("Model")).toEqual(["Default"]);
  });

  it("offers Codex's live models once Codex is picked, and saves the pair", async () => {
    const { draft } = await open();
    fireEvent.change(field("#agent-identity-name"), { target: { value: "Coder" } });
    pick("Runtime", "Codex");
    expect(tabLabels("Model")).toEqual(["Default", "GPT-6 Sol", "GPT-6 Luna"]);
    pick("Model", "GPT-6 Luna");
    press("Create");
    expect(draftToCreateBody(draft())).toMatchObject({ runtime: "codex", model: "gpt-6-luna" });
  });

  it("drops a model the new runtime lacks, and clearing the runtime clears the model", async () => {
    const stored = identity({ runtime: "claude", model: "claude-opus-5" });
    const { draft } = await open({ identity: stored });
    expect(tabLabels("Model")).toEqual(["Default", "Opus 5", "Sonnet 5"]);
    pick("Runtime", "Codex");
    expect(row("Model").getByRole("tab", { name: "Default" }).getAttribute("aria-selected")).toBe(
      "true"
    );
    pick("Runtime", "Any");
    press("Save");
    expect(draftToPatchBody(draft(), stored)).toEqual({ runtime: null, model: null });
  });

  it("with no desktop, keeps the stored pair as itself and offers no Claude list", async () => {
    desktop.present = false;
    await open({ identity: identity({ runtime: "codex", model: "gpt-6-sol" }) });
    expect(tabLabels("Runtime")).toEqual(["Any", "codex"]);
    expect(tabLabels("Model")).toEqual(["Default", "gpt-6-sol"]);
  });

  it("with no desktop and no stored runtime, renders no Runtime row", async () => {
    desktop.present = false;
    await open();
    expect(screen.queryByRole("tablist", { name: "Runtime" })).toBeNull();
    expect(tabLabels("Model")).toEqual(["Default"]);
  });
});

describe("the description clamp is the schema's", () => {
  it("keeps a 1,200-character description whole through an edit", async () => {
    const long = "x".repeat(1200);
    const stored = identity({ description: long });
    const { draft } = await open({ identity: stored });
    fireEvent.change(field("#agent-identity-description"), { target: { value: `${long}y` } });
    press("Save");
    expect(draft().description).toHaveLength(1201);
  });
});
