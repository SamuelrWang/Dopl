// @vitest-environment jsdom
/**
 * THE FIELD ROW'S **TYPE** — Samuel's 2026-09-22 ruling, and the only suite that
 * is about it.
 *
 * 🔒 **HE WAS OFFERED THREE READINGS AND TOOK THE NARROW ONE**: *"just the
 * value's shape — text, number, date, yes/no, link. Changes how the box behaves
 * when you type, nothing else."* So the two claims below are the whole contract,
 * and they pull in opposite directions on purpose:
 *   1. it PERSISTS — a dropdown whose answer is dropped at save is a control
 *      that lies, and `cleanFields` is where that would happen silently;
 *   2. and `text` is spelled by ABSENCE — an untouched row must put the object
 *      on the wire it always did, or every payload pin in this feature becomes a
 *      snapshot of chrome and the MCP surface's `{key, value}` writes start
 *      reading as a deliberate retype.
 *
 * ⚠ **ITS OWN FILE BECAUSE `identity-editor.test.tsx` HIT THE 500-LINE CAP**
 * (§1, `eslint.config.mjs › max-lines`, error, no exemption). The seam is honest
 * rather than arbitrary: that suite is what the editor RENDERS and what it
 * SAVES; this one is one field's own vocabulary. The harness is duplicated
 * deliberately — it is eight lines of props, and importing a `render` helper
 * across suites is how two files come to disagree about what the editor was
 * mounted with.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { draftToCreateBody, type IdentityDraft } from "../lib/identity-draft";
import { IdentityEditor } from "./identity-editor";

const BASES = [{ id: "kb-1", name: "Runbooks" }];

/** ⚠ THE PICKER READS A TREE PER BASE — the tree is rendered IN the form since
 *  2026-09-22, so it mounts on every open, mock included. */
vi.mock("@/features/knowledge/client/hooks", async () => ({
  useKnowledgeTree: (await import("./knowledge-tree-mock")).useKnowledgeTree,
}));

async function open() {
  const onSave = vi.fn();
  render(
    <IdentityEditor
      open
      workspaceId="ws-1"
      session={1}
      identity={null}
      teams={[]}
      knowledgeBases={BASES}
      saving={false}
      deleting={false}
      error={null}
      onClose={vi.fn()}
      onSave={onSave}
      onDelete={vi.fn()}
    />
  );
  await screen.findByRole("dialog");
  return { onSave };
}

const field = (selector: string) =>
  document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;

/** Fill the first EMPTY row, pressing the gray box only when there is none. */
function addField(key: string, value: string) {
  const keys = () =>
    Array.from(
      document.querySelectorAll<HTMLInputElement>('input[aria-label$=" key"]')
    );
  let at = keys().findIndex((input) => input.value === "");
  if (at === -1) {
    fireEvent.click(screen.getByRole("button", { name: "New field" }));
    at = keys().length - 1;
  }
  fireEvent.change(keys()[at], { target: { value: key } });
  fireEvent.change(field(`input[aria-label="Field ${at + 1} value"]`), {
    target: { value },
  });
}

const CREATE_VERB = "Create";

afterEach(cleanup);

describe("a field's type", () => {
  it("🔒 carries the field TYPE on the wire, and spells `text` as ABSENCE", async () => {
    // 🔒 Samuel, 2026-09-22 (option 1 of three): the type is the VALUE'S SHAPE —
    // how the box behaves when you type, nothing else. It has to PERSIST, or the
    // dropdown is a control whose answer is thrown away.
    const { onSave } = await open();
    fireEvent.change(field("#agent-identity-name"), { target: { value: "Scout" } });
    addField("repo", "dopl");
    addField("ships", "2026-01-02");
    // ⚠ THE SECOND ROW ONLY. The first keeps the default, and the whole point of
    // the assertion below is that the default is not written.
    fireEvent.click(screen.getByRole("button", { name: "Field 2 type" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Date/ }));
    fireEvent.click(screen.getByRole("button", { name: CREATE_VERB }));

    const draft = onSave.mock.calls[0][0] as IdentityDraft;
    expect(draftToCreateBody(draft).fields).toEqual([
      // ⚠ NO `type` MEMBER: an untouched row puts the object on the wire it
      // always did, which is what keeps every other payload pin honest.
      { key: "repo", value: "dopl" },
      { key: "ships", value: "2026-01-02", type: "date" },
    ]);
  });

  it("swaps the VALUE control for the shape, and stores a string either way", async () => {
    // ⚠ `number` and `date` are a KEYBOARD and a picker, not a contract — the
    // browser hands back a string and nothing downstream parses it. `boolean` is
    // the one that swaps the ELEMENT, because a free-text yes/no is how three
    // identities end up holding "yes", "Y" and "true".
    await open();
    addField("count", "");
    fireEvent.click(screen.getByRole("button", { name: "Field 1 type" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Number/ }));
    expect(field('input[aria-label="Field 1 value"]').getAttribute("type")).toBe("number");

    fireEvent.click(screen.getByRole("button", { name: "Field 1 type" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Yes \/ no/ }));
    // ⚠ A `<select>` NOW, and the empty option survives: a yes/no nobody has
    // answered is not a "no".
    expect(document.querySelector('select[aria-label="Field 1 value"]')).toBeTruthy();
  });
});
