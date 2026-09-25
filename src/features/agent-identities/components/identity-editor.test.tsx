// @vitest-environment jsdom
// The editor with no desktop bridge. Siblings: `-payload` (every control in one body), `-runtime`
// (Runtime/Model rows), `-surface` (class-string rulings, a source read).

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

// The form renders the knowledge tree; the factory imports the fake because `vi.mock` is hoisted.
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
    // A container has no teams (INVARIANTS §4A), and a private container identity is reachable
    // from no surface, so `lib/visibility.ts › SECTIONS_CONTAINER` holds only the shared scope.
    await open({ sections: SECTIONS_CONTAINER, containerKind: "link" });
    expect(tabLabels("Visibility")).toEqual(["Shared in this channel"]);
  });

  it("takes its LABELS from `lib/visibility.ts`, never from a literal here", async () => {
    // A hand-typed "Shared in this channel" would pass the case above and drift on a rename.
    await open({ sections: SECTIONS_CONTAINER, containerKind: "link" });
    for (const section of SECTIONS_CONTAINER) {
      expect(row("Visibility").getByRole("tab", { name: section.label })).toBeTruthy();
    }
  });
});

describe("the team picker", () => {
  it("is ABSENT until the scope is Team", async () => {
    await open();
    // The Team pill always exists; the "Add team" picker must not, or it asks for a grant the save
    // discards.
    expect(row("Visibility").getByRole("tab", { name: "Team" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add team" })).toBeNull();
  });

  it("appears the moment the operator picks Team, and takes MORE than one", async () => {
    // Multi: `teamIds` is a set, so a single-value control would drop the other grants on save.
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
  // `shared/ui/form-dialog.tsx`'s rules, re-asserted because DESIGN-SYSTEM.md claims this dialog
  // conforms; the recipes themselves are pinned in `channels/components/launch-agent-dialog.test.tsx`.
  it("puts a BOLD label ABOVE every control, from ONE class", async () => {
    await open();
    const labels = [
      "Name",
      "Description",
      "Instructions",
      "Model",
      "Visibility",
      "Fields",
      "Knowledge",
    ].map((t) => screen.getByText(t));
    // The weight lives in `form-dialog.module.css › .label`, never per caller.
    for (const el of labels) expect(el.className).not.toMatch(/font-(semibold|medium|normal)/);
    expect(new Set(labels.map((el) => el.className)).size).toBe(1);
  });

  it("makes text entry the UNDERLINE, and grows the line on focus", async () => {
    // `.lineActive` is React state, not `:focus-within`: the one layer a render can assert (jsdom
    // loads no CSS).
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
    // `multiline` is the whole difference, so Enter breaks the line instead of submitting.
    await open();
    expect(field("#agent-identity-name").tagName).toBe("INPUT");
    expect(field("#agent-identity-description").tagName).toBe("TEXTAREA");
    expect(field("#agent-identity-instructions").tagName).toBe("TEXTAREA");
  });

  it("makes every SINGLE choice a pill row, and closes on the 30px pair", async () => {
    await open();
    expect(screen.getByRole("tablist", { name: "Model" })).toBeTruthy();
    expect(screen.getByRole("tablist", { name: "Visibility" })).toBeTruthy();
    // The small scale: 36px belongs to the page button that opens a popup.
    for (const name of ["Discard", CREATE_VERB]) {
      expect(screen.getByRole("button", { name }).className).toContain(
        "h-[var(--action-h-sm)]"
      );
    }
  });

  it("keeps the schema's own length caps, which the kit's field cannot state", async () => {
    // No `maxLength` on the kit field; the handler clamps, so no save 400s on a length the operator
    // cannot see.
    const { draft } = await open();
    fireEvent.change(field("#agent-identity-name"), {
      target: { value: "x".repeat(200) },
    });
    press(CREATE_VERB);
    expect(draft().name).toHaveLength(120);
  });
});

describe("no Team scope outside a standard workspace", () => {
  // The client half; the server fence is `server/service-write-gates.ts › assertTeamScopeGrantable`.
  it("offers all three in a STANDARD workspace", async () => {
    await open({ containerKind: "standard" });
    expect(tabLabels("Visibility")).toEqual(["Private", "Team", "Public"]);
  });

  it.each(["home", "link"] as const)(
    "drops Team in a %s container, and keeps the rest in order",
    async (kind) => {
      await open({ containerKind: kind });
      expect(tabLabels("Visibility")).toEqual(["Private", "Public"]);
      expect(screen.queryByRole("button", { name: "Add team" })).toBeNull();
    }
  );

  it("SHOWS a stored `team` row rather than rewriting it, and refuses Save", async () => {
    // Not rewritten on open: silently moving a stored audience would decide a sharing fact on a
    // form the operator may close without saving.
    await open({
      containerKind: "home",
      identity: filledIdentity({ visibility: "team", teamIds: ["team-1"] }),
    });
    const pill = row("Visibility").getByRole("tab", { name: /^Team/ });
    expect(pill.getAttribute("aria-selected")).toBe("true");
    expect(pill.textContent).toContain("workspace only");
    expect(screen.queryByRole("button", { name: "Add team" })).toBeNull();

    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(save.title).toBe("Team sharing needs a workspace.");
  });

  it("lets Save through the moment the operator picks a value the container holds", async () => {
    const { draft } = await open({
      containerKind: "home",
      identity: filledIdentity({ visibility: "team", teamIds: ["team-1"] }),
    });
    pick("Visibility", "Private");
    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    // The grants go with the scope: the schema refuses `teamIds` on a non-team patch.
    expect(draft()).toMatchObject({ visibility: "private", teamIds: [] });
  });

  it("no longer offers the pill it just dropped, once the row is off Team", async () => {
    await open({
      containerKind: "home",
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
    // An untouched row is the common case (a new identity opens on one); `cleanFields` is the
    // backstop, pinned in `../lib/identity-draft.test.ts`.
    const { draft } = await open();
    fireEvent.change(field("#agent-identity-name"), { target: { value: "Scout" } });
    press("New field");
    press(CREATE_VERB);
    expect(draftToCreateBody(draft()).fields).toBeUndefined();
  });

  it("opens a NEW identity on one blank row, and the box adds another", async () => {
    // The blank row is `emptyDraft()`'s, not the component's: an edited identity with no fields
    // gets none, because there an empty row reads as a deleted one.
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
    // The confirm is its own `ModalShell`, so it too mounts a frame later.
    const confirm = await screen.findByRole("button", { name: "Delete identity" });
    expect(onDelete).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("permanently deletes");
    fireEvent.click(confirm);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
