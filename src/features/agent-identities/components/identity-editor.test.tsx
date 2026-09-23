// @vitest-environment jsdom
/**
 * THE EDITOR — the fields, the controls, and the dialogs over the dialog.
 *
 * ⚠ **THE PAYLOAD HALF MOVED TO `identity-editor-payload.test.tsx` ON
 * 2026-09-08**, at the 500-line cap, when the knowledge picker's tree mock
 * landed here. The third such cut on this file: the SOURCE READ went to
 * `identity-editor-surface.test.tsx` and the attachment count to
 * `identity-editor-knowledge.test.tsx`, both for the same reason.
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
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { draftToCreateBody } from "../lib/identity-draft";
import { SECTIONS_CONTAINER } from "../lib/visibility";
import {
  CREATE_VERB,
  addField,
  field,
  filledIdentity,
  open,
  pick,
  press,
  row,
  tabLabels,
} from "./identity-editor-harness";

/** ⚠ THE PICKER READS A TREE PER BASE. Shape in `./knowledge-tree-mock`; the
 *  factory imports it because `vi.mock` is hoisted above every binding. */
vi.mock("@/features/knowledge/client/hooks", async () => ({
  useKnowledgeTree: (await import("./knowledge-tree-mock")).useKnowledgeTree,
}));

afterEach(cleanup);

describe("what the editor renders", () => {
  it("carries every field an identity IS", async () => {
    await open();
    expect(field("#agent-identity-name")).toBeTruthy();
    expect(field("#agent-identity-description")).toBeTruthy();
    expect(field("#agent-identity-instructions")).toBeTruthy();
    expect(tabLabels("Visibility")).toEqual(["Private", "Team", "Public"]);
    expect(row("Model").getByRole("tab", { name: "Default" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "New field" })).toBeTruthy();
    // ⚠ **THE KNOWLEDGE TREE IS IN THE FORM, NOT BEHIND AN ADD BUTTON**
    // (Samuel, 2026-09-22) — so what this asserts is the tree itself.
    expect(screen.getByRole("tree", { name: "Knowledge" })).toBeTruthy();
  });

  it("loads an existing identity's values, chips included", async () => {
    await open({ identity: filledIdentity() });
    expect(field("#agent-identity-name").value).toBe("Release captain");
    expect(field("#agent-identity-instructions").value).toBe("Be terse.");
    expect(field('input[aria-label="Field 1 key"]').value).toBe("repo");
    expect(screen.getByRole("button", { name: "Detach Runbooks" })).toBeTruthy();
  });

  it("offers Delete only when there is something to delete", async () => {
    await open();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    cleanup();
    await open({ identity: filledIdentity() });
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
  });

  it("puts the server's own wording on the alert line", async () => {
    await open({ error: "An identity with that name already exists." });
    expect(screen.getByRole("alert").textContent).toBe(
      "An identity with that name already exists."
    );
  });
});

describe("the visibility scopes the mount offers", () => {
  it("is the workspace's three by default, in `SECTIONS` order", async () => {
    await open();
    expect(tabLabels("Visibility")).toEqual(["Private", "Team", "Public"]);
  });

  it("is ONE inside a link container, and it is not called Public", async () => {
    // ⚠ A container has no teams (INVARIANTS §4A), so `team` there is a scope
    // that can never resolve to anybody — and `workspace` means "the other
    // people in this relationship", not "everyone in your company".
    // 🔒 ⚠ IT WAS **TWO** UNTIL 2026-08-27. `private` went with the /home pane's
    // per-channel private section: a container is not navigable, so a private
    // container identity is now reachable from no surface at all — offering the
    // option would create write-only rows. The array IS the control, so the
    // array is where that door closes (`lib/visibility.ts`).
    await open({ sections: SECTIONS_CONTAINER, containerKind: "link" });
    expect(tabLabels("Visibility")).toEqual(["Shared in this channel"]);
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
    const { draft } = await open();
    fireEvent.change(field("#agent-identity-name"), { target: { value: "Scout" } });
    pick("Visibility", "Team");
    press("Add team");
    fireEvent.click(screen.getByRole("menuitem", { name: "Platform" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Growth" }));
    press(CREATE_VERB);
    expect(draftToCreateBody(draft())).toEqual({
      name: "Scout",
      visibility: "team",
      teamIds: ["team-1", "team-2"],
    });
  });

  it("refuses Save while a Team identity names no team", async () => {
    await open();
    fireEvent.change(field("#agent-identity-name"), { target: { value: "Scout" } });
    const save = screen.getByRole("button", { name: CREATE_VERB });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    pick("Visibility", "Team");
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
   * `channels/components/launch-agent-dialog.test.tsx`.
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
      // ⚠ **"Knowledge" SINCE 2026-09-08** (Samuel: *"rename knowledge bases
      // to knowledge"*) — no longer only a base.
      "Knowledge",
    ].map((t) => screen.getByText(t));
    // The weight lives in `form-dialog.module.css › .label`, never per caller.
    for (const el of labels) expect(el.className).not.toMatch(/font-(semibold|medium|normal)/);
    expect(new Set(labels.map((el) => el.className)).size).toBe(1);
  });

  it("makes text entry the UNDERLINE, and grows the line on focus", async () => {
    // ⚠ `.lineActive` is React state, not `:focus-within` — jsdom loads no
    // stylesheet, so this is the only layer of the sweep a render can assert.
    await open();
    const name = field("#agent-identity-name");
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
    expect(field("#agent-identity-name").tagName).toBe("INPUT");
    expect(field("#agent-identity-description").tagName).toBe("TEXTAREA");
    expect(field("#agent-identity-instructions").tagName).toBe("TEXTAREA");
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
    const { draft } = await open();
    fireEvent.change(field("#agent-identity-name"), {
      target: { value: "x".repeat(200) },
    });
    press(CREATE_VERB);
    expect(draft().name).toHaveLength(120);
  });
});

describe("no Team scope outside a standard workspace", () => {
  /**
   * Samuel, 2026-09-08: *"we should remove the team option, if it's in the home
   * space, because the team thing is for workspaces."* The client half; the
   * fence is `server/service-write-gates.ts › assertTeamScopeGrantable`.
   */
  it("offers all three in a STANDARD workspace", async () => {
    await open({ containerKind: "standard" });
    expect(tabLabels("Visibility")).toEqual(["Private", "Team", "Public"]);
  });

  it.each(["personal", "link"] as const)(
    "drops Team in a %s container, and keeps the rest in order",
    async (kind) => {
      await open({ containerKind: kind });
      expect(tabLabels("Visibility")).toEqual(["Private", "Public"]);
      expect(screen.queryByRole("button", { name: "Add team" })).toBeNull();
    }
  );

  it("SHOWS a stored `team` row rather than rewriting it, and refuses Save", async () => {
    // ⚠ NOT REWRITTEN ON OPEN. Moving a stored audience to `private` behind the
    // operator's back would be this editor deciding a sharing fact (§11) — on a
    // form they may close without saving.
    await open({
      containerKind: "personal",
      identity: filledIdentity({ visibility: "team", teamIds: ["team-1"] }),
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
    const { draft } = await open({
      containerKind: "personal",
      identity: filledIdentity({ visibility: "team", teamIds: ["team-1"] }),
    });
    pick("Visibility", "Private");
    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    // ⚠ AND THE GRANTS GO WITH THE SCOPE — the schema refuses a `teamIds` key on
    // a non-team patch, so carrying them would 400 the next unrelated edit.
    expect(draft()).toMatchObject({ visibility: "private", teamIds: [] });
  });

  it("no longer offers the pill it just dropped, once the row is off Team", async () => {
    await open({
      containerKind: "personal",
      identity: filledIdentity({ visibility: "team", teamIds: ["team-1"] }),
    });
    pick("Visibility", "Private");
    expect(tabLabels("Visibility")).toEqual(["Private", "Public"]);
  });
});

describe("the save payload", () => {
  it("is the trimmed name plus the scope, and nothing the operator left empty", async () => {
    const { draft } = await open();
    fireEvent.change(field("#agent-identity-name"), { target: { value: "  Scout  " } });
    press(CREATE_VERB);
    expect(draftToCreateBody(draft())).toEqual({ name: "Scout", visibility: "private" });
  });

  it("writes NO field for a row the operator opened and never typed in", async () => {
    // 🔒 **THE STARTER ROW MUST COST NOTHING (Samuel, 2026-09-22).** A new
    // identity opens holding one blank row and the gray box appends more, so an
    // untouched row is the COMMON case rather than an edge one — and the create
    // body has to be byte-identical to what it was when adding was a dialog.
    // `cleanFields` is the backstop and it is pinned on its own in
    // `../lib/identity-draft.test.ts`; this is the face's half.
    const { draft } = await open();
    fireEvent.change(field("#agent-identity-name"), { target: { value: "Scout" } });
    press("New field");
    press(CREATE_VERB);
    expect(draftToCreateBody(draft()).fields).toBeUndefined();
  });

  it("opens a NEW identity on one blank row, and the box adds another", async () => {
    // 🔒 Samuel, 2026-09-22: a new identity *"should have an existing blank
    // field that is already in, just have it blank"*. ⚠ The row is
    // `emptyDraft()`'s, not the component's — an identity being EDITED with no
    // fields gets none, because there an empty row reads as one somebody
    // deleted.
    await open();
    expect(field('input[aria-label="Field 1 key"]')).toBeTruthy();
    expect(field('input[aria-label="Field 1 key"]').value).toBe("");
    expect(document.querySelector('input[aria-label="Field 2 key"]')).toBeNull();
    press("New field");
    expect(field('input[aria-label="Field 2 key"]')).toBeTruthy();
  });

  it("removes the row the X names, and leaves the rest", async () => {
    await open({ identity: filledIdentity() });
    press("Remove field 1");
    expect(document.querySelector('input[aria-label="Field 1 key"]')).toBeNull();
  });
});

describe("a field's type", () => {
  it("carries the field TYPE on the wire, and spells `text` as ABSENCE", async () => {
    // The type must persist (a dropdown whose answer is dropped at save lies); `text` stays
    // absent, so an untouched row puts the same `{key, value}` on the wire as before types.
    const { draft } = await open();
    fireEvent.change(field("#agent-identity-name"), { target: { value: "Scout" } });
    addField("repo", "dopl");
    addField("ships", "2026-01-02");
    press("Field 2 type");
    fireEvent.click(await screen.findByRole("menuitem", { name: /Date/ }));
    press(CREATE_VERB);
    expect(draftToCreateBody(draft()).fields).toEqual([
      { key: "repo", value: "dopl" },
      { key: "ships", value: "2026-01-02", type: "date" },
    ]);
  });

  it("swaps the VALUE control for the shape, and stores a string either way", async () => {
    // `number`/`date` change only the keyboard; `boolean` swaps the element so a yes/no is never free text.
    await open();
    addField("count", "");
    press("Field 1 type");
    fireEvent.click(await screen.findByRole("menuitem", { name: /Number/ }));
    expect(field('input[aria-label="Field 1 value"]').getAttribute("type")).toBe("number");

    press("Field 1 type");
    fireEvent.click(await screen.findByRole("menuitem", { name: /Yes \/ no/ }));
    // A `<select>` keeping its empty option: an unanswered yes/no is not a "no".
    expect(document.querySelector('select[aria-label="Field 1 value"]')).toBeTruthy();
  });
});

describe("attached bases this view cannot reach", () => {
  // Only a count reaches this viewer; nothing may name the dropped base (id, name or container).
  it("says how many, and never which", async () => {
    await open({ identity: filledIdentity({ unreachableKnowledgeBaseCount: 2 }) });
    expect(screen.getByText(/2 attachments aren't reachable from here/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Detach Runbooks" })).toBeTruthy();
    // `kb-2`/`Specs` are in the editor's options, so resolving the count against them would leak.
    const line = screen.getByText(/aren't reachable from here/).textContent ?? "";
    expect(line).not.toMatch(/kb-|Specs|workspace|channel/);
  });

  // `0` is a decided answer and an absent field an undecorated row; neither prints a line (INVARIANTS §5).
  it("says nothing when every attached base is reachable", async () => {
    await open({ identity: filledIdentity({ unreachableKnowledgeBaseCount: 0 }) });
    expect(screen.queryByText(/reachable from here/)).toBeNull();
    cleanup();
    await open({ identity: filledIdentity() });
    expect(screen.queryByText(/reachable from here/)).toBeNull();
  });

  it("says nothing while creating an identity", async () => {
    await open();
    expect(screen.queryByText(/reachable from here/)).toBeNull();
  });
});

describe("delete is behind the confirm, and the copy says HARD", () => {
  it("does not fire until the confirmation is taken", async () => {
    const { onDelete } = await open({ identity: filledIdentity() });
    press("Delete");
    // ⚠ The confirm is its own `ModalShell`, so it too arrives a frame later.
    const confirm = await screen.findByRole("button", { name: "Delete identity" });
    expect(onDelete).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("permanently deletes");
    fireEvent.click(confirm);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
