// @vitest-environment jsdom
/**
 * THE STANDARD DIALOG'S CONTRACT — the three things Samuel standardised on
 * 2026-08-27 and the four dialogs now inherit rather than each restate.
 *
 * ⚠ CLASS STRINGS, NOT COMPUTED STYLE. jsdom loads no stylesheet, so
 * `getComputedStyle` would report the same nothing for a centered heading and a
 * left-aligned one. Same shape as
 * `features/agent-templates/components/template-editor-surface.test.tsx › no concave
 * surfaces`: the recipe IS the assertion.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SECTION_HEADING_TEXT } from "./section-heading";
import {
  DialogActions,
  DialogField,
  DIALOG_BTN_PRIMARY,
  DIALOG_BTN_SECONDARY,
  StandardDialog,
} from "./standard-dialog";

afterEach(cleanup);

/** ⚠ `ModalShell` mounts a FRAME after `open` flips (it animates in). */
async function open(onClose = vi.fn()) {
  render(
    <StandardDialog open onClose={onClose} title="New channel">
      <DialogField label="Name" hint="(optional)" htmlFor="x">
        <input id="x" />
      </DialogField>
      <DialogActions leading={<button type="button">Delete</button>}>
        <button type="button" className={DIALOG_BTN_SECONDARY}>
          Cancel
        </button>
        <button type="button" className={DIALOG_BTN_PRIMARY}>
          Create
        </button>
      </DialogActions>
    </StandardDialog>
  );
  return { dialog: await screen.findByRole("dialog"), onClose };
}

describe("the heading", () => {
  it("is CENTERED and TITLE-CASED in CSS, leaving the accessible name alone", async () => {
    const { dialog } = await open();
    // The name a screen reader says, and what every `getByRole("dialog", …)`
    // in the suites matches: the string, in the case it was written.
    expect(dialog.getAttribute("aria-label")).toBe("New channel");
    const heading = screen.getByRole("heading", { name: "New channel" });
    expect(heading.className).toContain("text-center");
    // 🔒 TITLE CASE IN CSS, the section heading type (Samuel, 2026-09-13) — not
    // uppercase any more.
    expect(heading.className).toContain("capitalize");
    expect(heading.className).not.toMatch(/\buppercase\b/);
    for (const token of SECTION_HEADING_TEXT.split(" ")) {
      expect(heading.className).toContain(token);
    }
    // ⚠ ONE type for every title — the section heading's, never a per-dialog
    // size (`docs/DESIGN-SYSTEM.md` § Type scale).
    expect(heading.className).not.toContain("text-title");
  });

  /**
   * 🔒 **A TITLE THAT CARRIES A NAME SOMEBODY TYPED KEEPS ITS OWN CASING.** CSS
   * `capitalize` uppercases the first letter of EVERY word and cannot be told
   * which words are the operator's, so "Share iPhone leads" rendered as "Share
   * IPhone Leads" — the dialog misspelling the row it is about. Samuel's Title
   * Case ruling is about the AUTHORED titles, which is why the default stays
   * `true` and `titleCase={false}` is the exception (`pages/home/ontology-share.tsx`).
   */
  it("drops `capitalize` — and nothing else — when `titleCase` is false", async () => {
    render(
      <StandardDialog open onClose={vi.fn()} title="Share iPhone leads" titleCase={false}>
        <p>body</p>
      </StandardDialog>
    );
    const dialog = await screen.findByRole("dialog");
    expect(dialog.getAttribute("aria-label")).toBe("Share iPhone leads");
    const heading = screen.getByRole("heading", { name: "Share iPhone leads" });
    expect(heading.className).not.toMatch(/\bcapitalize\b/);
    expect(heading.className).not.toMatch(/\buppercase\b/);
    // Same centring and the same type — only the casing is opted out of.
    expect(heading.className).toContain("text-center");
    for (const token of SECTION_HEADING_TEXT.split(" ")) {
      expect(heading.className).toContain(token);
    }
  });
});

describe("the footer pair", () => {
  it("is FULLY ROUNDED on both buttons", async () => {
    await open();
    for (const name of ["Cancel", "Create"]) {
      expect(screen.getByRole("button", { name }).className).toContain("rounded-full");
    }
  });

  it("puts the destructive verb on the LEFT and the pair on the right", async () => {
    await open();
    const row = screen.getByRole("button", { name: "Delete" }).parentElement!;
    const order = Array.from(row.querySelectorAll("button")).map((b) => b.textContent);
    expect(order).toEqual(["Delete", "Cancel", "Create"]);
  });
});

describe("the field header", () => {
  it("is the uppercase label, and the hint is NOT part of it", async () => {
    await open();
    const label = screen.getByText("Name").closest("label")!;
    expect(label.className).toContain("uppercase");
    expect(label.getAttribute("for")).toBe("x");
    // ⚠ `normal-case` on the hint: the label is uppercased, and "(OPTIONAL)"
    // shouting beside the field name is not what the hint is for.
    expect(screen.getByText("(optional)").className).toContain("normal-case");
  });
});

describe("closing", () => {
  it("hands the X its own accessible name, defaulting to Close", async () => {
    const { onClose } = await open();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
