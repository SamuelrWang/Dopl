// @vitest-environment jsdom
/**
 * THE EDITOR — the fields, the body they become, and the surface rule.
 *
 * ⚠ THE LAST DESCRIBE IS A SOURCE READ, NOT A RENDER. Samuel's ruling for this
 * page (2026-08-22) is that **nothing on it is pressed in** — no `FIELD_WELL`,
 * no `.concave-field`, no `.concave-track`, no `SECTION_BOX_INSET`. That is a
 * property of the CLASS STRINGS, not of the DOM: jsdom loads no stylesheet, so a
 * rendered assertion would pass against a concave field and prove nothing. The
 * same shape as the token-purity checks elsewhere in this tree
 * (`billing/components/billing-page-screen.test.tsx › what the page deliberately
 * leaves out`).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { AgentTemplate } from "../client/types";
import { draftToCreateBody, type TemplateDraft } from "../lib/template-draft";
import { TemplateEditor } from "./template-editor";

const TEAMS = [
  { id: "team-1", name: "Platform" },
  { id: "team-2", name: "Growth" },
];
const BASES = [
  { id: "kb-1", name: "Runbooks" },
  { id: "kb-2", name: "Specs" },
];

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
    createdBy: "user-1",
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
    ...over,
  };
}

/**
 * ⚠ `await`ed because `ModalShell` mounts a FRAME after `open` flips (it
 * animates in), so nothing is in the DOM on the render that asked for it — the
 * same reason `channels-v2/thread-manage.test.tsx` awaits its confirm.
 */
async function open(over: Partial<React.ComponentProps<typeof TemplateEditor>> = {}) {
  const onSave = vi.fn();
  const onDelete = vi.fn();
  const onClose = vi.fn();
  render(
    <TemplateEditor
      open
      session={1}
      template={null}
      teams={TEAMS}
      knowledgeBases={BASES}
      saving={false}
      deleting={false}
      error={null}
      onClose={onClose}
      onSave={onSave}
      onDelete={onDelete}
      {...over}
    />
  );
  await screen.findByRole("dialog");
  return { onSave, onDelete, onClose };
}

const field = (selector: string) =>
  document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;

afterEach(cleanup);

describe("what the editor renders", () => {
  it("carries every field a template IS", async () => {
    await open();
    expect(field("#agent-template-name")).toBeTruthy();
    expect(field("#agent-template-description")).toBeTruthy();
    expect(field("#agent-template-instructions")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Private" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Team" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Public" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Model" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add field" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Attach" })).toBeTruthy();
  });

  it("loads an existing template's values, chips included", async () => {
    await open({ template: template() });
    expect(field("#agent-template-name").value).toBe("Release captain");
    expect(field("#agent-template-instructions").value).toBe("Be terse.");
    expect(field('input[aria-label="Field 1 key"]').value).toBe("repo");
    expect(screen.getByRole("button", { name: "Detach Runbooks" })).toBeTruthy();
  });

  it("offers Delete only when there is something to delete", async () => {
    await open();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    cleanup();
    await open({ template: template() });
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
  });

  it("puts the server's own wording on the alert line", async () => {
    await open({ error: "A template with that name already exists." });
    expect(screen.getByRole("alert").textContent).toBe(
      "A template with that name already exists."
    );
  });
});

describe("the team picker", () => {
  it("is ABSENT until the scope is Team", async () => {
    await open();
    // The Team SCOPE is a `tab` and always exists; the PICKER is the "Add team"
    // button and must not, or the editor asks for a grant it will discard.
    expect(screen.getByRole("tab", { name: "Team" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add team" })).toBeNull();
  });

  it("appears the moment the operator picks Team, and takes MORE than one", async () => {
    // ⚠ MULTI, because the server's `teamIds` is a set — a single-value control
    // would drop every other grant on the next save.
    const { onSave } = await open();
    fireEvent.change(field("#agent-template-name"), { target: { value: "Scout" } });
    fireEvent.click(screen.getByRole("tab", { name: "Team" }));
    fireEvent.click(screen.getByRole("button", { name: "Add team" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Platform" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Growth" }));
    fireEvent.click(screen.getByRole("button", { name: "Create template" }));

    const draft = onSave.mock.calls[0][0] as TemplateDraft;
    expect(draftToCreateBody(draft)).toEqual({
      name: "Scout",
      visibility: "team",
      teamIds: ["team-1", "team-2"],
    });
  });

  it("refuses Save while a Team template names no team", async () => {
    await open();
    fireEvent.change(field("#agent-template-name"), { target: { value: "Scout" } });
    const save = screen.getByRole("button", { name: "Create template" });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("tab", { name: "Team" }));
    expect(
      (screen.getByRole("button", { name: "Create template" }) as HTMLButtonElement).disabled
    ).toBe(true);
  });
});

describe("the save payload", () => {
  it("is the trimmed name plus the scope, and nothing the operator left empty", async () => {
    const { onSave } = await open();
    fireEvent.change(field("#agent-template-name"), { target: { value: "  Scout  " } });
    fireEvent.click(screen.getByRole("button", { name: "Create template" }));
    const draft = onSave.mock.calls[0][0] as TemplateDraft;
    expect(draftToCreateBody(draft)).toEqual({ name: "Scout", visibility: "private" });
  });

  it("carries instructions, custom fields and attached bases", async () => {
    const { onSave } = await open();
    fireEvent.change(field("#agent-template-name"), { target: { value: "Scout" } });
    fireEvent.change(field("#agent-template-instructions"), {
      target: { value: "Search first." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add field" }));
    fireEvent.change(field('input[aria-label="Field 1 key"]'), {
      target: { value: "repo" },
    });
    fireEvent.change(field('input[aria-label="Field 1 value"]'), {
      target: { value: "dopl" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Attach" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Specs" }));
    fireEvent.click(screen.getByRole("button", { name: "Create template" }));

    const draft = onSave.mock.calls[0][0] as TemplateDraft;
    expect(draftToCreateBody(draft)).toEqual({
      name: "Scout",
      visibility: "private",
      instructions: "Search first.",
      fields: [{ key: "repo", value: "dopl" }],
      knowledgeBaseIds: ["kb-2"],
    });
  });

  it("drops a field row the operator added and abandoned", async () => {
    const { onSave } = await open();
    fireEvent.change(field("#agent-template-name"), { target: { value: "Scout" } });
    fireEvent.click(screen.getByRole("button", { name: "Add field" }));
    fireEvent.click(screen.getByRole("button", { name: "Create template" }));
    const draft = onSave.mock.calls[0][0] as TemplateDraft;
    expect(draftToCreateBody(draft).fields).toBeUndefined();
  });
});

describe("delete is behind the confirm, and the copy says HARD", () => {
  it("does not fire until the confirmation is taken", async () => {
    const { onDelete } = await open({ template: template() });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    // ⚠ The confirm is its own `ModalShell`, so it too arrives a frame later.
    const confirm = await screen.findByRole("button", { name: "Delete template" });
    expect(onDelete).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("permanently deletes");
    fireEvent.click(confirm);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});

describe("no concave surfaces", () => {
  // ⚠ SOURCE READ. jsdom loads no stylesheet, so the only honest place to pin a
  // SURFACE ruling is the class strings themselves.
  const ROOT = path.join(process.cwd(), "src", "features", "agent-templates");
  // ⚠ The UI half only. `server/` renders nothing and has no surface to get
  // wrong; sweeping it would make this suite fail for reasons that are not the
  // ruling, in a directory this page does not own.
  const UI_DIRS = ["components", "lib", "hooks", "client"];
  const FORBIDDEN = [
    "concave-field",
    "concave-track",
    "auth-field-3d",
    "FIELD_WELL",
    "SECTION_BOX_INSET",
    "SectionBox",
  ];

  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return sources(full);
      if (!/\.tsx?$/.test(entry.name)) return [];
      // The rule is about what the feature SHIPS; this file names the strings it
      // forbids, and a test asserting on itself is a false positive by
      // construction.
      if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) return [];
      return [full];
    });
  }

  const FILES = UI_DIRS.flatMap((dir) => sources(path.join(ROOT, dir)));

  it("finds source files to check (a silent empty sweep would pass forever)", () => {
    expect(FILES.length).toBeGreaterThan(5);
  });

  it.each(FILES)("%s wears no pressed-in recipe", (file) => {
    const source = readFileSync(file, "utf8");
    // Comments EXPLAIN the ruling by naming the classes it bans, so the check
    // runs over code lines only.
    const code = source
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    for (const forbidden of FORBIDDEN) {
      expect(code, `${file} must not use ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("uses the kit's RAISED well for its inputs", () => {
    const rows = readFileSync(path.join(ROOT, "components", "template-editor-rows.tsx"), "utf8");
    expect(rows).toContain("RAISED_WELL");
  });
});
