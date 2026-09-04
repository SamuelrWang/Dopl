/**
 * The wire shape of a section read. ⚠ The SPLIT itself is proved in
 * `shared/knowledge/markdown-sections.test.ts`; what is proved here is the
 * three promises this projection makes to a client: an untouched response when
 * neither argument is passed, an empty body whenever the content was not the
 * answer, and an outline beside every refusal.
 */

import { describe, it, expect } from "vitest";
import type { KnowledgeEntry } from "../types";
import { outlinePayload, projectFile } from "./service-sections";

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
