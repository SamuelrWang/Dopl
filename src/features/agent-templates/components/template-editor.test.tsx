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
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { AgentTemplate } from "../client/types";
import {
  draftToCreateBody,
  draftToPatchBody,
  type TemplateDraft,
} from "../lib/template-draft";
import { SECTIONS_CONTAINER } from "../lib/visibility";
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

/**
 * ⚠ SCOPED BY DIALOG NAME, ALWAYS. Adding a field opens a SECOND
 * `StandardDialog` over the editor (2026-08-27), so from that moment "Cancel"
 * is two buttons and `getByRole` on the bare name throws. Every add-field
 * interaction goes through this helper, or through
 * `within(screen.getByRole("dialog", { name: "Add field" }))`.
 */
async function addField(key: string, value: string) {
  fireEvent.click(screen.getByRole("button", { name: "Add field" }));
  const dialog = await screen.findByRole("dialog", { name: "Add field" });
  fireEvent.change(field("#add-field-key"), { target: { value: key } });
  fireEvent.change(field("#add-field-value"), { target: { value } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));
}

/** The create verb, in ONE place — the kit conversion shortened the word. */
const CREATE_VERB = "Create";

/**
 * ⚠ EVERY PILL LOOKUP IS SCOPED TO ITS ROW. Model and Visibility are both
 * `PillChoice` now, so `getAllByRole("tab")` spans two controls and a bare
 * `getByRole("tab", { name })` can match the wrong one.
 */
const row = (name: string) =>
  within(screen.getByRole("tablist", { name }));

/** Pick a MODEL by its full label. */
function pickModel(label: string) {
  fireEvent.click(row("Model").getByRole("tab", { name: label }));
}

/** Pick a VISIBILITY scope by the label `lib/visibility.ts` gives it. */
function pickScope(label: string) {
  fireEvent.click(row("Visibility").getByRole("tab", { name: label }));
}

/** The scope pills on screen, in order, as text. */
const scopeLabels = () =>
  row("Visibility")
    .getAllByRole("tab")
    .map((t) => t.textContent);

afterEach(cleanup);

describe("what the editor renders", () => {
  it("carries every field a template IS", async () => {
    await open();
    expect(field("#agent-template-name")).toBeTruthy();
    expect(field("#agent-template-description")).toBeTruthy();
    expect(field("#agent-template-instructions")).toBeTruthy();
    expect(scopeLabels()).toEqual(["Private", "Team", "Public"]);
    expect(row("Model").getByRole("tab", { name: "Default" })).toBeTruthy();
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

describe("the visibility scopes the mount offers", () => {
  it("is the workspace's three by default, in `SECTIONS` order", async () => {
    await open();
    expect(scopeLabels()).toEqual(["Private", "Team", "Public"]);
  });

  it("🔒 is ONE inside a link container, and it is not called Public", async () => {
    // ⚠ A container has no teams (INVARIANTS §4A), so `team` there is a scope
    // that can never resolve to anybody — and `workspace` means "the other
    // people in this relationship", not "everyone in your company".
    // 🔒 ⚠ IT WAS **TWO** UNTIL 2026-08-27. `private` went with the /home pane's
    // per-channel private section: a container is not navigable, so a private
    // container template is now reachable from no surface at all — offering the
    // option would create write-only rows. The array IS the control, so the
    // array is where that door closes (`lib/visibility.ts`).
    await open({ sections: SECTIONS_CONTAINER, containerKind: "link" });
    expect(scopeLabels()).toEqual(["Shared in this channel"]);
  });

  it("takes its LABELS from `lib/visibility.ts`, never from a literal here", async () => {
    // The point of the prop is that the container's headings and the pane's
    // headings are one array. A component hand-typing "Shared in this channel"
    // would pass every assertion above and drift on the first rename.
    await open({ sections: SECTIONS_CONTAINER, containerKind: "link" });
    for (const section of SECTIONS_CONTAINER) {
      expect(row("Visibility").getByRole("tab", { name: section.label })).toBeTruthy();
    }
  });
});

describe("the team picker", () => {
  it("is ABSENT until the scope is Team", async () => {
    await open();
    // The Team SCOPE is a `tab` and always exists; the PICKER is the "Add team"
    // button and must not, or the editor asks for a grant it will discard.
    expect(row("Visibility").getByRole("tab", { name: "Team" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add team" })).toBeNull();
  });

  it("appears the moment the operator picks Team, and takes MORE than one", async () => {
    // ⚠ MULTI, because the server's `teamIds` is a set — a single-value control
    // would drop every other grant on the next save.
    const { onSave } = await open();
    fireEvent.change(field("#agent-template-name"), { target: { value: "Scout" } });
    pickScope("Team");
    fireEvent.click(screen.getByRole("button", { name: "Add team" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Platform" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Growth" }));
    fireEvent.click(screen.getByRole("button", { name: CREATE_VERB }));

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
    const save = screen.getByRole("button", { name: CREATE_VERB });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    pickScope("Team");
    expect(
      (screen.getByRole("button", { name: CREATE_VERB }) as HTMLButtonElement).disabled
    ).toBe(true);
  });
});

describe("the popup-form kit's anatomy", () => {
  /**
   * ⚠ THE PIN IS THE KIT, NOT A COPY OF IT. Every rule below is
   * `shared/ui/form-dialog.tsx`'s and is asserted here only because THIS dialog
   * is claimed Done in `docs/DESIGN-SYSTEM.md`'s conformance table — a claim a
   * later edit could quietly falsify. The recipes themselves are pinned once, in
   * `channels-v2/launch-agent-dialog.test.tsx`.
   */
  it("puts a BOLD label ABOVE every control, from ONE class", async () => {
    await open();
    const labels = [
      "Name",
      "Description",
      "Instructions",
      "Model",
      "Visibility",
      "Fields",
      "Knowledge bases",
    ].map((t) => screen.getByText(t));
    // The weight lives in `form-dialog.module.css › .label`, never per caller.
    for (const el of labels) expect(el.className).not.toMatch(/font-(semibold|medium|normal)/);
    expect(new Set(labels.map((el) => el.className)).size).toBe(1);
  });

  it("makes text entry the UNDERLINE, and grows the line on focus", async () => {
    // ⚠ `.lineActive` is React state, not `:focus-within` — jsdom loads no
    // stylesheet, so this is the only layer of the sweep a render can assert.
    await open();
    const name = field("#agent-template-name");
    const line = name.parentElement as HTMLElement;
    expect(line.className).not.toMatch(/lineActive/);
    fireEvent.focus(name);
    expect(line.className).toMatch(/lineActive/);
    fireEvent.blur(name);
    expect(line.className).not.toMatch(/lineActive/);
  });

  it("swaps the ELEMENT and nothing else for the long fields", async () => {
    // Description and Instructions are prose; `multiline` is the whole
    // difference, so Enter breaks the line instead of submitting.
    await open();
    expect(field("#agent-template-name").tagName).toBe("INPUT");
    expect(field("#agent-template-description").tagName).toBe("TEXTAREA");
    expect(field("#agent-template-instructions").tagName).toBe("TEXTAREA");
  });

  it("makes every SINGLE choice a pill row, and closes on the 30px pair", async () => {
    await open();
    expect(screen.getByRole("tablist", { name: "Model" })).toBeTruthy();
    expect(screen.getByRole("tablist", { name: "Visibility" })).toBeTruthy();
    // ⚠ THE SMALL SCALE. The 36px scale belongs to the PAGE button that opens a
    // popup; a dialog cut to it is the drift the kit exists to stop.
    for (const name of ["Discard", CREATE_VERB]) {
      expect(screen.getByRole("button", { name }).className).toContain(
        "h-[var(--action-h-sm)]"
      );
    }
  });

  it("keeps the schema's own length caps, which the kit's field cannot state", async () => {
    // ⚠ `maxLength` went with the boxes; the handler clamps instead, so no save
    // can 400 on a length the operator could not see.
    const { onSave } = await open();
    fireEvent.change(field("#agent-template-name"), {
      target: { value: "x".repeat(200) },
    });
    fireEvent.click(screen.getByRole("button", { name: CREATE_VERB }));
    const draft = onSave.mock.calls[0][0] as TemplateDraft;
    expect(draft.name).toHaveLength(120);
  });
});

describe("🔒 no Team scope outside a standard workspace", () => {
  /**
   * Samuel, 2026-09-08: *"we should remove the team option, if it's in the home
   * space, because the team thing is for workspaces."* The client half; the
   * fence is `server/service-write-gates.ts › assertTeamScopeGrantable`.
   */
  it("offers all three in a STANDARD workspace", async () => {
    await open({ containerKind: "standard" });
    expect(scopeLabels()).toEqual(["Private", "Team", "Public"]);
  });

  it.each(["personal", "link"] as const)(
    "drops Team in a %s container, and keeps the rest in order",
    async (kind) => {
      await open({ containerKind: kind });
      expect(scopeLabels()).toEqual(["Private", "Public"]);
      expect(screen.queryByRole("button", { name: "Add team" })).toBeNull();
    }
  );

  it("SHOWS a stored `team` row rather than rewriting it, and refuses Save", async () => {
    // ⚠ NOT REWRITTEN ON OPEN. Moving a stored audience to `private` behind the
    // operator's back would be this editor deciding a sharing fact (§11) — on a
    // form they may close without saving.
    await open({
      containerKind: "personal",
      template: template({ visibility: "team", teamIds: ["team-1"] }),
    });
    const pill = row("Visibility").getByRole("tab", { name: /^Team/ });
    expect(pill.getAttribute("aria-selected")).toBe("true");
    expect(pill.textContent).toContain("workspace only");
    // …and the picker that would ask for a team it cannot offer is absent.
    expect(screen.queryByRole("button", { name: "Add team" })).toBeNull();

    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(save.title).toBe("Team sharing needs a workspace.");
  });

  it("lets Save through the moment the operator picks a value the container holds", async () => {
    const { onSave } = await open({
      containerKind: "personal",
      template: template({ visibility: "team", teamIds: ["team-1"] }),
    });
    pickScope("Private");
    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    // ⚠ AND THE GRANTS GO WITH THE SCOPE — the schema refuses a `teamIds` key on
    // a non-team patch, so carrying them would 400 the next unrelated edit.
    const draft = onSave.mock.calls[0][0] as TemplateDraft;
    expect(draft).toMatchObject({ visibility: "private", teamIds: [] });
  });

  it("no longer offers the pill it just dropped, once the row is off Team", async () => {
    await open({
      containerKind: "personal",
      template: template({ visibility: "team", teamIds: ["team-1"] }),
    });
    pickScope("Private");
    expect(scopeLabels()).toEqual(["Private", "Public"]);
  });
});

describe("the save payload", () => {
  it("is the trimmed name plus the scope, and nothing the operator left empty", async () => {
    const { onSave } = await open();
    fireEvent.change(field("#agent-template-name"), { target: { value: "  Scout  " } });
    fireEvent.click(screen.getByRole("button", { name: CREATE_VERB }));
    const draft = onSave.mock.calls[0][0] as TemplateDraft;
    expect(draftToCreateBody(draft)).toEqual({ name: "Scout", visibility: "private" });
  });

  it("carries instructions, custom fields and attached bases", async () => {
    const { onSave } = await open();
    fireEvent.change(field("#agent-template-name"), { target: { value: "Scout" } });
    fireEvent.change(field("#agent-template-instructions"), {
      target: { value: "Search first." },
    });
    await addField("repo", "dopl");
    fireEvent.click(screen.getByRole("button", { name: "Attach" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Specs" }));
    fireEvent.click(screen.getByRole("button", { name: CREATE_VERB }));

    const draft = onSave.mock.calls[0][0] as TemplateDraft;
    expect(draftToCreateBody(draft)).toEqual({
      name: "Scout",
      visibility: "private",
      instructions: "Search first.",
      fields: [{ key: "repo", value: "dopl" }],
      knowledgeBaseIds: ["kb-2"],
    });
  });

  it("adds nothing when the Add-field dialog is abandoned", async () => {
    // ⚠ THE OLD SHAPE OF THIS TEST ("drops a field ROW the operator added and
    // abandoned") described the inline `+` that appended a blank pair. Adding
    // is a dialog since 2026-08-27, so an abandoned add leaves no row at all —
    // the `cleanFields` backstop it used to exercise stays pinned in
    // `../lib/template-draft.test.ts`, where it does not depend on the chrome.
    const { onSave } = await open();
    fireEvent.change(field("#agent-template-name"), { target: { value: "Scout" } });
    fireEvent.click(screen.getByRole("button", { name: "Add field" }));
    const dialog = await screen.findByRole("dialog", { name: "Add field" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Discard" }));
    fireEvent.click(screen.getByRole("button", { name: CREATE_VERB }));
    const draft = onSave.mock.calls[0][0] as TemplateDraft;
    expect(draftToCreateBody(draft).fields).toBeUndefined();
  });

  it("refuses a pair with no key — the value alone would vanish at save", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Add field" }));
    const dialog = await screen.findByRole("dialog", { name: "Add field" });
    const add = () => within(dialog).getByRole("button", { name: "Add" }) as HTMLButtonElement;
    expect(add().disabled).toBe(true);
    fireEvent.change(field("#add-field-key"), { target: { value: "repo" } });
    expect(add().disabled).toBe(false);
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
    fireEvent.click(screen.getByRole("button", { name: "Attach" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Specs" }));
    fireEvent.click(screen.getByRole("button", { name: CREATE_VERB }));

    const draft = onSave.mock.calls[0][0] as TemplateDraft;
    expect(draftToCreateBody(draft)).toEqual({
      name: "Scout",
      visibility: "workspace",
      description: "Finds things",
      instructions: "Search first.",
      model: "claude-opus-5",
      fields: [{ key: "repo", value: "dopl" }],
      knowledgeBaseIds: ["kb-2"],
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
      knowledgeBaseIds: [],
    });
  });
});
