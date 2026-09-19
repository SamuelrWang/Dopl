/**
 * The wire shape of a section read — the SPLIT itself is proved in
 * `shared/knowledge/markdown-sections.test.ts`. Three promises: an untouched
 * response when neither argument is passed, an empty body whenever the content
 * was not the answer, and an outline beside every refusal.
 */

import { describe, it, expect } from "vitest";
import type { KnowledgeEntry } from "../types";
import { headingNames, outlinePayload, projectFile } from "./service-sections";

const BODY = "# Title\nintro\n\n## Setup\ninstall\n\n## Usage\nrun\n";

function entry(body: string): KnowledgeEntry {
  return { id: "e1", title: "Notes", body } as unknown as KnowledgeEntry;
}

describe("projectFile", () => {
  it("with neither argument, returns the entry and NOTHING else", () => {
    expect(projectFile(entry(BODY), {})).toEqual({ entry: entry(BODY) });
  });

  it("outline-only empties the body — the point is not to send it", () => {
    const out = projectFile(entry(BODY), { outline: true });
    expect(out.entry.body).toBe("");
    expect(out.outline?.totalChars).toBe(BODY.length);
    expect(out.outline?.sections.map((s) => s.heading)).toEqual([
      "Title",
      "Setup",
      "Usage",
    ]);
    expect(out.section).toBeUndefined();
  });

  it("a section read narrows the body and still carries the outline", () => {
    const out = projectFile(entry(BODY), { section: "Setup" });
    expect(out.entry.body).toBe("## Setup\ninstall\n\n");
    expect(out.section).toMatchObject({ ok: true, heading: "Setup", level: 2 });
    expect(out.outline?.sections).toHaveLength(3);
  });

  it("an unknown section is a MISS carrying the outline, not an empty success", () => {
    const out = projectFile(entry(BODY), { section: "Nope" });
    expect(out.section).toEqual({ ok: false, reason: "SECTION_NOT_FOUND" });
    expect(out.entry.body).toBe("");
    expect(out.outline?.sections.map((s) => s.heading)).toEqual([
      "Title",
      "Setup",
      "Usage",
    ]);
  });

  it("an ambiguous section names both lines and sends no body", () => {
    const out = projectFile(entry("## N\na\n## N\nb\n"), { section: "N" });
    expect(out.entry.body).toBe("");
    expect(out.section).toMatchObject({ ok: false, reason: "SECTION_AMBIGUOUS" });
    if (out.section?.ok !== false || out.section.reason !== "SECTION_AMBIGUOUS") {
      throw new Error("unreachable");
    }
    expect(out.section.matches.map((m) => m.line)).toEqual([1, 3]);
  });

  it("a body with no headings outlines as empty rather than as one section", () => {
    expect(outlinePayload("just prose\n")).toEqual({
      sections: [],
      totalChars: 11,
    });
  });

  it("section reads never mutate the entry they were handed", () => {
    const original = entry(BODY);
    projectFile(original, { section: "Setup" });
    expect(original.body).toBe(BODY);
  });
});

/**
 * 🔒 **WAVE 4 a1 — THE HEADING LIST, WHICH IS NOT AN OUTLINE.** `outlinePayload`
 * carries four numbers per heading because a caller deciding WHETHER to read
 * one needs the cost; a caller deciding WHICH ENTRY to open needs only the
 * words, and a tree renders hundreds of rows.
 */
describe("headingNames", () => {
  it("returns level-prefixed names, and nothing else", () => {
    expect(headingNames(BODY)).toEqual(["# Title", "## Setup", "## Usage"]);
  });

  it("is empty for a body with no headings", () => {
    expect(headingNames("just prose\n")).toEqual([]);
  });

  // ⚠ The prefix is not decoration: `## Errors` and `### Errors` are different
  // addresses, and a bare `Errors` is one the caller cannot always pass back.
  it("distinguishes two headings that share a name at different levels", () => {
    expect(headingNames("## Errors\na\n### Errors\nb\n")).toEqual([
      "## Errors",
      "### Errors",
    ]);
  });
});

/**
 * ⚠ **`headings` IS NOT `outline` WITH THE BODY LEFT IN — THEY ARE OPPOSITE
 * TRADES.** `outline` returns the map INSTEAD of the document; `headings`
 * returns it WITH the document, so a caller that has already decided to read
 * never pays a second call to learn what it can address next time.
 */
describe("projectFile({ headings })", () => {
  it("keeps the WHOLE body and adds the outline beside it", () => {
    const out = projectFile(entry(BODY), { headings: true });
    expect(out.entry.body).toBe(BODY);
    expect(out.outline?.sections.map((s) => s.heading)).toEqual([
      "Title",
      "Setup",
      "Usage",
    ]);
    expect(out.section).toBeUndefined();
  });

  // ⚠ `outline` WINS when both are asked for: it is the narrower answer, and
  // returning the document anyway would spend exactly what it exists to save.
  it("still empties the body when outline is asked for too", () => {
    expect(projectFile(entry(BODY), { outline: true, headings: true }).entry.body).toBe("");
  });

  // ⚠ INVARIANTS §8: a client that sends neither flag gets byte-for-byte what
  // it always got — no new key on a call it already makes.
  it("adds nothing at all when neither flag is passed", () => {
    expect(projectFile(entry(BODY), {})).toEqual({ entry: entry(BODY) });
  });
});
