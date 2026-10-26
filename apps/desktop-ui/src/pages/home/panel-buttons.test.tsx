/**
 * 🔒 THE FOUR /home SECTION-CREATE BUTTONS ARE THE PAGE'S BLACK BUTTON
 * (Samuel, 2026-09-09: the Knowledge and Agents "+ New" buttons go *"from their
 * white to be the same black button as the New thread button … the heights of
 * the button should be the black button height"*).
 *
 * ⚠ THIS FILE PINNED THE OPPOSITE UNTIL THAT RULING, and half of it still does.
 * The 2026-08-28 ruling put every small /home button on the KB card's Open pill
 * (`open-scale-button.tsx`, 30px, white); the new ruling moves ONLY the SECTION
 * HEADER's create — a page action — and leaves the card's own Open and the
 * "Share into this channel" button beside it exactly where they were. Both
 * halves are asserted here, together, because "they used to be one face" is
 * precisely how a future edit would put them back on one.
 *
 * Three claims:
 *
 *   1. `CreateButton` wears `pillButton("ink", "lg")` — the "New channel" button's own
 *      class list — by RENDERING it, not by reading its source.
 *   2. That constant is the only declaration of the recipe in `pages/home`: the
 *      three call sites that spelled it out by hand read it now, so a restyle
 *      cannot land on whichever file the next reader opened.
 *   3. The card-scale pill survives where it was NOT named — `ShareIntoChannelButton`
 *      is still the card Open's face, class for class.
 *
 * ⚠ MUTATION-VERIFIED: putting the `h-6 …` recipe back on any converted button
 * turns the scan red; putting `OpenScaleButton` back inside `CreateButton`
 * turns claim 1 red; re-spelling the black recipe in `home-header.tsx` or
 * `add-person-dialog.tsx` turns claim 2 red.
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BaseCard } from "@/features/knowledge/components/knowledge-v2/home/base-card";
import type { KnowledgeBase } from "@/features/knowledge/types";
import { LaunchIntoChannelButton } from "@/features/agent-identities/components/identity-card-actions";
import { CreateButton, PILL_ICON, pillButton } from "@/shared/ui/pill-button";

/** This directory, and the knowledge module up in the web tree. See the note
 *  in the scan below for why neither is written inline. */
const HERE = "./";
const KNOWLEDGE_CSS =
  "../../../../../src/features/knowledge/components/knowledge-v2/knowledge-v2.module.css";
/** The ROOT tree's shared UI, where the black recipe is declared. A variable for the same
 *  reason `HERE` is one, below. */
const SHARED_UI_REL = "../../../../../src/shared/ui/";

const BASE = {
  id: "kb-1",
  name: "Renewals",
  createdBy: "user-1",
  visibility: "private",
  workspaceId: "ws-1",
} as KnowledgeBase;

/** The classes a button actually ends up wearing, order-insensitive. */
function faceOf(name: RegExp | string): Set<string> {
  const el = screen.getByRole("button", { name });
  return new Set(el.className.split(/\s+/).filter(Boolean));
}

describe("the /home section button IS the page's black action button", () => {
  it("🔒 wears the ink lg pill, class for class", () => {
    render(<CreateButton onClick={() => {}}>Knowledge base</CreateButton>);

    // Each adds exactly what a section header needs of it and nothing else:
    // the glyph gap, and the disabled ink it already had.
    const expected = new Set([
      ...pillButton("ink", "lg").split(/\s+/),
      "disabled:opacity-60",
    ]);
    expect(faceOf("Knowledge base")).toEqual(expected);
    // …and that face is really the black pill, not two empty class lists
    // agreeing with each other.
    expect(expected.has("raise-ink")).toBe(true);
    expect(expected.has("h-9")).toBe(true);
  });

  it("🔒 keeps the Plus glyph, at the black pill's own icon size", () => {
    // A create button that lost its glyph reads as a filter, not an add — and
    // Samuel's label for all four is "+ <noun>", so the `+` IS half the label.
    render(<CreateButton onClick={() => {}}>Knowledge base</CreateButton>);
    const svg = screen
      .getByRole("button", { name: "Knowledge base" })
      .querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("width")).toBe(String(PILL_ICON.lg));
  });
});

describe("no page-local copy of either recipe is left in pages/home", () => {
  // ⚠ Anchored on a FILE, not on `new URL(".", …)`: under vitest that form
  // resolves to a non-`file:` URL and `fileURLToPath` throws.
  // ⚠ THE SPECIFIER IS A VARIABLE ON PURPOSE. Vite rewrites
  // `new URL("<literal>", import.meta.url)` into an ASSET url — under vitest
  // that comes back as a non-`file:` scheme and `fileURLToPath` throws. Held
  // in a const, the call is left alone and resolves against this file.
  const dir = fileURLToPath(new URL(HERE, import.meta.url));
  const SHARED_UI = fileURLToPath(new URL(SHARED_UI_REL, import.meta.url));
  const all = readdirSync(dir)
    .filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"))
    .map((f) => [f, readFileSync(`${dir}${f}`, "utf8")] as const);
  /**
   * ⚠ **SKELETONS ARE OUT OF THE `h-6` SCAN, AND THE REASON IS THE SCAN'S OWN
   * SUBJECT (2026-09-13).** The banned thing is a 24px BUTTON; a skeleton paints
   * no button at all (INVARIANTS §1A: *"NO TEXT, NOTHING PRESSABLE"*), and what
   * its `h-6` blocks stand for are controls that live in `channels/components/` and are
   * genuinely 24px there — the channel header's bookmark `IconButton
   * className="h-6 w-6"` and the composer toolbar's six glyphs. Restating those
   * as `h-[24px]` to satisfy a text scan would paint the same pixels while
   * breaking §1A's GEOMETRY-BY-REFERENCE rule, which is the worse trade.
   * ⚠ THE EXCLUSION IS ASSERTED, NOT ASSUMED — the case below proves these files
   * carry no `<button` at all, so nothing can hide a 24px pill behind the name.
   */
  const isSkeleton = (f: string) => f.includes("skeleton");
  const sources = all.filter(([f]) => !isSkeleton(f));

  it("🔒 no button className carries `h-6`", () => {
    // ⚠ The whole recipe is not what is banned — the HEIGHT is. `h-6` in a
    // button's class list is the old 24px pill by definition, whatever else it
    // spells, and this file's own docblock quotes it, so the scan reads
    // className strings rather than the raw file text.
    const offenders = sources.flatMap(([file, text]) =>
      [...text.matchAll(/className="([^"]*)"/g)]
        .filter(([, classes]) => /(^|\s)h-6(\s|$)/.test(classes))
        .map(([, classes]) => `${file}: ${classes}`)
    );
    expect(offenders).toEqual([]);
  });

  it("🔒 …and the skeletons it excuses press nothing at all", () => {
    const skeletons = all.filter(([f]) => isSkeleton(f));
    expect(skeletons.length).toBeGreaterThan(0);
    for (const [file, text] of skeletons) {
      // ⚠ OVER COMMENT-STRIPPED SOURCE, the lesson the skeleton suites already
      // learned: these files SAY "no `<button>`" in their docblocks, so a raw
      // scan fails on the very sentence it is checking.
      const code = text
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(`${file}: ${code.includes("<button")}`).toBe(`${file}: false`);
    }
  });

  it("🔒 the black recipe is declared once, in the shared tree, and never in pages/home", () => {
    // The black faces: `raise-ink` (the ink pill) and `auth-btn-3d` followed by a SPACE (`-light` is
    // a different recipe).
    const local = sources
      .filter(([, text]) => /"(auth-btn-3d|raise-ink) /.test(text))
      .map(([file]) => file);
    expect(local).toEqual([]);
    expect(pillButton("ink", "lg").startsWith("raise-ink ")).toBe(true);
  });

  it("🔒 `CreateButton` is declared exactly once", () => {
    const declaring = sources
      .filter(([, text]) => /function CreateButton\b/.test(text))
      .map(([file]) => file);
    expect(declaring).toEqual([]);
    expect(readFileSync(`${SHARED_UI}pill-button.tsx`, "utf8")).toMatch(
      /function CreateButton\b/
    );
  });
});

describe("the CARD-scale pill survives where the ruling did not reach", () => {
  it("🔒 the knowledge card's Open is still the shared card-scale pill", () => {
    render(
      <BaseCard
        base={BASE}
        ownerLabel="You"
        starred={false}
        onOpen={() => {}}
        onToggleStar={() => {}}
      />
    );
    const open = faceOf(/Open Renewals/);
    expect(open.has("btn-light")).toBe(true);
    expect(open.size).toBeGreaterThan(1);
  });

  it("🔒 `LaunchIntoChannelButton` is the small ink pill, not a 3D or full-width face", () => {
    render(<LaunchIntoChannelButton onClick={() => {}} disabled={false} busy={false} />);
    const launch = faceOf("Launch");
    for (const cls of pillButton("ink", "sm").split(/\s+/)) expect(launch.has(cls)).toBe(true);
    expect(launch.has("w-full")).toBe(false);
    expect(launch.has("btn-light")).toBe(false);
  });

  it("🔒 the knowledge module no longer declares the pill", () => {
    // Deleting the shared rule and re-adding `.cardOpen` would restore today's
    // pixels and tomorrow's drift — the card must keep RENDERING the shared
    // component, so no local rule may exist for it to wear.
    const css = readFileSync(
      fileURLToPath(new URL(KNOWLEDGE_CSS, import.meta.url)),
      "utf8"
    );
    expect(css).not.toMatch(/^\.cardOpen\s*\{/m);
  });
});
