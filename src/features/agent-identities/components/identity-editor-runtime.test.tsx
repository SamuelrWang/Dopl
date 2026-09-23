// @vitest-environment jsdom
/**
 * The identity editor's Runtime and Model rows (rulings 4–6; F11, P7-12, X-03):
 * the Model row offers the IDENTITY's runtime's live models and nobody else's.
 * Before, it offered the registry default's (Claude's) catalog whatever the
 * operator meant, and a plain browser fell back to Claude's frozen four.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { AgentIdentity } from "../client/types";
import { draftToCreateBody, draftToPatchBody, type IdentityDraft } from "../lib/identity-draft";
import { IdentityEditor } from "./identity-editor";

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

function identity(over: Partial<AgentIdentity> = {}): AgentIdentity {
  return {
    id: "tpl-1",
    workspaceId: "ws-1",
    name: "Coder",
    description: null,
    instructions: null,
    model: null,
    runtime: null,
    fields: [],
    visibility: "private",
    teamIds: [],
    knowledgeBases: [],
    knowledge: [],
    createdBy: "user-1",
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
    ...over,
  };
}

async function open(row: AgentIdentity | null = null) {
  const onSave = vi.fn();
  render(
    <IdentityEditor
      open
      workspaceId="ws-1"
      session={1}
      identity={row}
      teams={[]}
      knowledgeBases={[]}
      saving={false}
      deleting={false}
      error={null}
      onClose={vi.fn()}
      onSave={onSave}
      onDelete={vi.fn()}
    />
  );
  await screen.findByRole("dialog");
  return { onSave, draft: () => onSave.mock.calls[0][0] as IdentityDraft };
}

const tabs = (name: string) =>
  within(screen.getByRole("tablist", { name }))
    .getAllByRole("tab")
    .map((t) => t.textContent);
const pick = (rowName: string, label: string) =>
  fireEvent.click(within(screen.getByRole("tablist", { name: rowName })).getByRole("tab", { name: label }));
const save = (verb: string) => fireEvent.click(screen.getByRole("button", { name: verb }));

beforeEach(() => {
  desktop.present = true;
});
afterEach(cleanup);

describe("the Model row is the identity runtime's roster", () => {
  it("offers only Default while no runtime is chosen — no borrowed catalog", async () => {
    await open();
    expect(tabs("Runtime")).toEqual(["Any", "Claude Code", "Codex", "Cursor"]);
    expect(tabs("Model")).toEqual(["Default"]);
  });

  it("offers Codex's live models once Codex is picked, and saves the pair", async () => {
    const { draft } = await open();
    fireEvent.change(document.querySelector("#agent-identity-name") as HTMLInputElement, {
      target: { value: "Coder" },
    });
    pick("Runtime", "Codex");
    expect(tabs("Model")).toEqual(["Default", "GPT-6 Sol", "GPT-6 Luna"]);
    pick("Model", "GPT-6 Luna");
    save("Create");
    expect(draftToCreateBody(draft())).toMatchObject({ runtime: "codex", model: "gpt-6-luna" });
  });

  it("drops a model the new runtime lacks, and clearing the runtime clears the model", async () => {
    const row = identity({ runtime: "claude", model: "claude-opus-5" });
    const { draft } = await open(row);
    expect(tabs("Model")).toEqual(["Default", "Opus 5", "Sonnet 5"]);
    pick("Runtime", "Codex");
    expect(
      within(screen.getByRole("tablist", { name: "Model" }))
        .getByRole("tab", { name: "Default" })
        .getAttribute("aria-selected")
    ).toBe("true");
    pick("Runtime", "Any");
    save("Save");
    expect(draftToPatchBody(draft(), row)).toEqual({ runtime: null, model: null });
  });

  it("with no desktop, keeps the stored pair as itself and offers no Claude list (P7-12)", async () => {
    desktop.present = false;
    await open(identity({ runtime: "codex", model: "gpt-6-sol" }));
    expect(tabs("Runtime")).toEqual(["Any", "codex"]);
    expect(tabs("Model")).toEqual(["Default", "gpt-6-sol"]);
  });

  it("with no desktop and no stored runtime, renders no Runtime row", async () => {
    desktop.present = false;
    await open();
    expect(screen.queryByRole("tablist", { name: "Runtime" })).toBeNull();
    expect(tabs("Model")).toEqual(["Default"]);
  });
});

describe("the description clamp is the schema's (P7-05)", () => {
  it("keeps a 1,200-character description whole through an edit", async () => {
    const long = "x".repeat(1200);
    const row = identity({ description: long });
    const { draft } = await open(row);
    const box = document.querySelector("#agent-identity-description") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: `${long}y` } });
    save("Save");
    expect(draft().description).toHaveLength(1201);
  });
});
