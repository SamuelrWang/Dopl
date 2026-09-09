// @vitest-environment jsdom
/**
 * ⚠ **ITS OWN FILE SINCE 2026-09-08, AND THE REASON IS §1's 500-LINE CAP.**
 * `template-editor.test.tsx` crossed it when the knowledge picker's tree mock
 * landed beside these cases (`eslint.config.mjs › max-lines`, `error`, no
 * exemption for this path). It is the same seam that file has already been cut
 * on twice — the SOURCE-READ half went to `template-editor-surface.test.tsx` and
 * the attachment half to `template-editor-knowledge.test.tsx`. What is here is
 * the PAYLOAD, whole; the fixture and the `open()` helper are local and
 * deliberately minimal, because a suite importing another's harness couples two
 * files that were split to be independent.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { AgentTemplate } from "../client/types";
import {
  draftToCreateBody,
  draftToPatchBody,
  type TemplateDraft,
} from "../lib/template-draft";
import { TemplateEditor } from "./template-editor";

/** ⚠ THE PICKER READS A TREE PER BASE. Shape in `./knowledge-tree-mock`; the
 *  factory imports it because `vi.mock` is hoisted above every binding. */
vi.mock("@/features/knowledge/client/hooks", async () => ({
  useKnowledgeTree: (await import("./knowledge-tree-mock")).useKnowledgeTree,
}));

const TEAMS = [
  { id: "team-1", name: "Platform" },
  { id: "team-2", name: "Growth" },
];
const BASES = [
  { id: "kb-1", name: "Runbooks" },
  { id: "kb-2", name: "Specs" },
];
const CREATE_VERB = "Create";

function template(over: Partial<AgentTemplate> = {}): AgentTemplate {
  return {
    id: "tpl-1",
    workspaceId: "ws-1",
    name: "Release captain",
    description: "Runs the checklist",
    instructions: "Be terse.",
    model: "claude-opus-5",
    fields: [{ key: "repo", value: "dopl" }],
    visibility: "private",
    teamIds: [],
    knowledgeBases: [{ id: "kb-1", name: "Runbooks" }],
    knowledge: [
      { baseId: "kb-1", baseName: "Runbooks", scope: "base", path: "Runbooks" },
    ],
    createdBy: "user-1",
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
    ...over,
  };
}

/** ⚠ `await`ed because `ModalShell` mounts a FRAME after `open` flips. */
async function open(over: Partial<React.ComponentProps<typeof TemplateEditor>> = {}) {
  const onSave = vi.fn();
  render(
    <TemplateEditor
      open
      workspaceId="ws-1"
      session={1}
      template={null}
      teams={TEAMS}
      knowledgeBases={BASES}
      saving={false}
      deleting={false}
      error={null}
      onClose={vi.fn()}
      onSave={onSave}
      onDelete={vi.fn()}
      {...over}
    />
  );
  await screen.findByRole("dialog");
  return { onSave };
}

const field = (selector: string) =>
  document.querySelector(selector) as HTMLInputElement;

async function addField(key: string, value: string) {
  fireEvent.click(screen.getByRole("button", { name: "Add field" }));
  const dialog = await screen.findByRole("dialog", { name: "Add field" });
  fireEvent.change(field("#add-field-key"), { target: { value: key } });
  fireEvent.change(field("#add-field-value"), { target: { value } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));
}

/** ⚠ THE TABLIST, addressed by its accessible name — `PillChoice` labels its
 *  own row, so a walk up from the label text would depend on markup this suite
 *  is deliberately not about. */
const row = (name: string) => within(screen.getByRole("tablist", { name }));

function pickModel(label: string) {
  fireEvent.click(row("Model").getByRole("tab", { name: label }));
}

function pickScope(label: string) {
  fireEvent.click(row("Visibility").getByRole("tab", { name: label }));
}

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
    const { onSave } = await open();
    fireEvent.change(field("#agent-template-name"), { target: { value: "  Scout  " } });
    fireEvent.change(field("#agent-template-description"), {
      target: { value: "  Finds things  " },
    });
    fireEvent.change(field("#agent-template-instructions"), {
      target: { value: "  Search first.  " },
    });
    pickModel("Opus 5");
    pickScope("Public");
    await addField("repo", "dopl");
    fireEvent.click(screen.getByRole("button", { name: "Add knowledge" }));
    fireEvent.click(screen.getByRole("treeitem", { name: "Specs" }));
    fireEvent.click(screen.getByRole("button", { name: CREATE_VERB }));

    const draft = onSave.mock.calls[0][0] as TemplateDraft;
    expect(draftToCreateBody(draft)).toEqual({
      name: "Scout",
      visibility: "workspace",
      description: "Finds things",
      instructions: "Search first.",
      model: "claude-opus-5",
      fields: [{ key: "repo", value: "dopl" }],
      knowledge: [{ baseId: "kb-2", scope: "base" }],
    });
  });

  it("EDIT — the PATCH is the CHANGED keys and nothing else", async () => {
    const row = template();
    const { onSave } = await open({ template: row });
    fireEvent.change(field("#agent-template-name"), { target: { value: "Release captain v2" } });
    fireEvent.change(field("#agent-template-description"), { target: { value: "" } });
    pickModel("Haiku 4.5");
    fireEvent.click(screen.getByRole("button", { name: "Detach Runbooks" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const draft = onSave.mock.calls[0][0] as TemplateDraft;
    expect(draftToPatchBody(draft, row)).toEqual({
      name: "Release captain v2",
      description: null,
      model: "claude-haiku-4-5-20251001",
      knowledge: [],
    });
  });
});
