/**
 * 🔒 ONE SOURCE FOR THE SMALL /home BUTTON (Samuel, 2026-08-28: every /home
 * button wearing the small create-button recipe adopts the KB card Open
 * button's size/UI).
 *
 * Two halves, and both have to hold or the ruling decays:
 *
 *   1. THE FACE IS THE CARD'S FACE — asserted by RENDERING both and comparing
 *      the classes, not by reading either one's source. A source test would
 *      pass on two files that happen to spell the same recipe, which is the
 *      state this change removed.
 *   2. NO `h-6` BUTTON RECIPE IS LEFT IN `pages/home` — a source scan, because
 *      the failure it guards is a NEW button hand-rolling the old pill next
 *      week, and no rendered tree can see a component that nobody wrote yet.
 *
 * ⚠ MUTATION-VERIFIED: restoring the `h-6 … px-2.5 text-caption` className on
 * ANY of the four converted buttons turns the scan red; on either of the two
 * rendered below (the create button, "Use in this channel") the face
 * comparison goes red with it. The Agents section's "Try again" is the one
 * converted button reachable only through a failed read, and the scan is what
 * holds it.
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BaseCard } from "@/features/knowledge/components/knowledge-v2/home/base-card";
import type { KnowledgeBase } from "@/features/knowledge/types";
import { UseInThisChannelButton } from "./agent-copy";
import { CreateButton } from "./panel-buttons";

/** This directory, and the knowledge module up in the web tree. See the note
 *  in the scan below for why neither is written inline. */
const HERE = "./";
const KNOWLEDGE_CSS =
  "../../../../../src/features/knowledge/components/knowledge-v2/knowledge-v2.module.css";

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

describe("the /home section button IS the KB card's Open button", () => {
  it("🔒 wears the card Open's face, class for class", () => {
    render(
      <>
        <BaseCard
          base={BASE}
          ownerLabel="You"
          starred={false}
          onOpen={() => {}}
          onToggleStar={() => {}}
        />
        <CreateButton onClick={() => {}}>New base</CreateButton>
        <UseInThisChannelButton onClick={() => {}} disabled={false} />
      </>
    );

    const open = faceOf(/Open Renewals/);

    // Each adds ONE thing to the shared face: the disabled ink it already had.
    // Everything else must be the same source's output.
    const withDisabledInk = new Set([...open, "disabled:opacity-60"]);
    expect(faceOf("New base")).toEqual(withDisabledInk);
    expect(faceOf("Use in this channel")).toEqual(withDisabledInk);
    // …and that face is really the shared pill, not empty class lists agreeing
    // with each other.
    expect(open.has("btn-light")).toBe(true);
    expect(open.size).toBeGreaterThan(1);
  });

  it("🔒 keeps the Plus glyph, at the pill's own icon size", () => {
    // The ruling kept the icon and only rescaled it; a create button that lost
    // its glyph reads as a filter, not an add.
    render(<CreateButton onClick={() => {}}>New base</CreateButton>);
    const svg = screen.getByRole("button", { name: "New base" }).querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("width")).toBe("12");
  });
});

describe("no page-local copy of the small pill is left in pages/home", () => {
  // ⚠ Anchored on a FILE, not on `new URL(".", …)`: under vitest that form
  // resolves to a non-`file:` URL and `fileURLToPath` throws.
  // ⚠ THE SPECIFIER IS A VARIABLE ON PURPOSE. Vite rewrites
  // `new URL("<literal>", import.meta.url)` into an ASSET url — under vitest
  // that comes back as a non-`file:` scheme and `fileURLToPath` throws. Held
  // in a const, the call is left alone and resolves against this file.
  const dir = fileURLToPath(new URL(HERE, import.meta.url));
  const sources = readdirSync(dir)
    .filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"))
    .map((f) => [f, readFileSync(`${dir}${f}`, "utf8")] as const);

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

  it("🔒 `CreateButton` is declared exactly once", () => {
    const declaring = sources
      .filter(([, text]) => /function CreateButton\b/.test(text))
      .map(([file]) => file);
    expect(declaring).toEqual(["panel-buttons.tsx"]);
  });
});

describe("the card's own Open is not a fork", () => {
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
