/**
 * The split that makes a heading an address. ⚠ Every case here is a shape a
 * REAL knowledge entry arrives in — a snippet-heavy runbook, a Windows paste, a
 * front-mattered note, a document somebody wrote two headings with one name in.
 */

import { describe, it, expect } from "vitest";
import {
  appendSection,
  findSection,
  outlineOf,
  replaceSection,
  sectionCount,
  sliceSection,
} from "./markdown-sections";

const DOC = [
  "# Title",
  "intro line",
  "",
  "## Setup",
  "install it",
  "",
  "### Windows",
  "run the exe",
  "",
  "## Usage",
  "call it",
  "",
].join("\n");

describe("outlineOf", () => {
  it("finds every #/##/### heading with its offset and line", () => {
    const { sections, totalChars } = outlineOf(DOC);
    expect(sections.map((s) => [s.heading, s.level])).toEqual([
      ["Title", 1],
      ["Setup", 2],
      ["Windows", 3],
      ["Usage", 2],
    ]);
    expect(totalChars).toBe(DOC.length);
    for (const s of sections) {
      expect(DOC.slice(s.start).startsWith("#")).toBe(true);
      expect(s.chars).toBe(s.end - s.start);
    }
  });

  it("an empty body has no sections and a total of zero", () => {
    expect(outlineOf("")).toEqual({ sections: [], totalChars: 0 });
  });

  it("a parent's span CONTAINS its children, so counts do not sum to the total", () => {
    const { sections } = outlineOf(DOC);
    const setup = sections[1];
    const windows = sections[2];
    expect(windows.start).toBeGreaterThan(setup.start);
    expect(windows.end).toBeLessThanOrEqual(setup.end);
  });

  it("### ends at the next ## — a higher level closes a lower one", () => {
    const { sections } = outlineOf(DOC);
    expect(DOC.slice(sections[2].start, sections[2].end)).toBe(
      "### Windows\nrun the exe\n\n",
    );
  });

  it("the last section runs to the end of the body", () => {
    const { sections } = outlineOf(DOC);
    expect(sections[3].end).toBe(DOC.length);
  });

  it("#### and deeper are body text, not boundaries", () => {
    const body = "## A\n#### deep\ntext\n## B\n";
    expect(outlineOf(body).sections.map((s) => s.heading)).toEqual(["A", "B"]);
    expect(sliceSection(body, "A")).toMatchObject({
      text: "## A\n#### deep\ntext\n",
    });
  });

  it("#hashtag with no space is not a heading", () => {
    expect(sectionCount("#nothing\n#### nope\n")).toBe(0);
  });

  it("a closing run of #s is trimmed off the name", () => {
    expect(outlineOf("## Setup ##\nx").sections[0].heading).toBe("Setup");
  });

  it("an empty heading is still a heading, with an empty name", () => {
    expect(outlineOf("##\nx").sections[0]).toMatchObject({ heading: "", level: 2 });
  });
});

describe("fenced code blocks", () => {
  it("a # inside a ``` fence is never a heading", () => {
    const body = [
      "## Script",
      "```bash",
      "# not a heading",
      "## also not",
      "```",
      "done",
      "",
    ].join("\n");
    expect(outlineOf(body).sections.map((s) => s.heading)).toEqual(["Script"]);
    expect(sliceSection(body, "Script")).toMatchObject({ text: body });
  });

  it("~~~ fences count too, and a ``` inside one does not close it", () => {
    const body = "## A\n~~~\n```\n# no\n~~~\n## B\ntail\n";
    expect(outlineOf(body).sections.map((s) => s.heading)).toEqual(["A", "B"]);
  });

  it("a longer closer closes, a shorter one does not", () => {
    const body = "## A\n```\n``\n# still fenced\n````\n## B\n";
    expect(outlineOf(body).sections.map((s) => s.heading)).toEqual(["A", "B"]);
  });

  it("an UNCLOSED fence swallows the rest of the document", () => {
    const body = "## A\n```\n## B\n## C\n";
    expect(outlineOf(body).sections.map((s) => s.heading)).toEqual(["A"]);
  });

  it("an info string on the opener does not make it a closer", () => {
    const body = "```ts\n# no\n```\n# yes\n";
    expect(outlineOf(body).sections.map((s) => s.heading)).toEqual(["yes"]);
  });
});

describe("setext headings", () => {
  it("=== is a level 1 and --- is a level 2", () => {
    const body = "Title\n=====\nintro\n\nPart\n----\nbody\n";
    expect(outlineOf(body).sections.map((s) => [s.heading, s.level])).toEqual([
      ["Title", 1],
      ["Part", 2],
    ]);
  });

  it("the section STARTS at the text line, not at the underline", () => {
    const body = "Title\n=====\nintro\n";
    expect(sliceSection(body, "Title")).toMatchObject({ text: body });
  });

  it("an underline with no paragraph above it is not a heading", () => {
    expect(sectionCount("\n---\ntext\n")).toBe(0);
    expect(sectionCount("---\n")).toBe(0);
  });

  it("an underline under an ATX heading is not a second heading", () => {
    const body = "## A\n---\ntext\n";
    expect(outlineOf(body).sections.map((s) => s.heading)).toEqual(["A"]);
  });

  it("YAML frontmatter is skipped whole, so its close is not a setext heading", () => {
    const body = "---\ntitle: Notes\ntags: [a]\n---\n\n## Real\nbody\n";
    expect(outlineOf(body).sections.map((s) => s.heading)).toEqual(["Real"]);
  });

  it("a setext underline inside a fence is not a heading", () => {
    expect(sectionCount("```\nTitle\n=====\n```\n")).toBe(0);
  });

  it("mixes with ATX headings and closes on level", () => {
    const body = "Top\n===\na\n\n## Sub\nb\n\nNext\n===\nc\n";
    const { sections } = outlineOf(body);
    expect(sections.map((s) => [s.heading, s.level])).toEqual([
      ["Top", 1],
      ["Sub", 2],
      ["Next", 1],
    ]);
    expect(body.slice(sections[0].start, sections[0].end)).toBe("Top\n===\na\n\n## Sub\nb\n\n");
  });
});

describe("line endings and trailing newlines", () => {
  const CRLF = "# A\r\nline\r\n\r\n## B\r\nlast\r\n";

  it("CRLF bodies split at the same headings", () => {
    expect(outlineOf(CRLF).sections.map((s) => s.heading)).toEqual(["A", "B"]);
  });

  it("CRLF offsets index the ORIGINAL body, carriage returns and all", () => {
    const { sections } = outlineOf(CRLF);
    expect(CRLF.slice(sections[1].start, sections[1].end)).toBe("## B\r\nlast\r\n");
  });

  it("a missing trailing newline loses nothing", () => {
    const body = "## A\nfirst\n## B\nlast";
    expect(sliceSection(body, "B")).toMatchObject({ text: "## B\nlast" });
    expect(outlineOf(body).sections[1].end).toBe(body.length);
  });

  it("a heading on the very last line with no newline is still a heading", () => {
    expect(outlineOf("text\n## Tail").sections.map((s) => s.heading)).toEqual(["Tail"]);
  });
});

describe("findSection", () => {
  it("matches exactly", () => {
    expect(findSection(DOC, "Setup")).toMatchObject({ ok: true });
  });

  it("accepts the heading pasted back with its # marks", () => {
    expect(findSection(DOC, "## Setup")).toMatchObject({ ok: true });
    expect(findSection(DOC, "  ###  Windows ")).toMatchObject({ ok: true });
  });

  it("falls back to case-insensitive when nothing matches exactly", () => {
    expect(findSection(DOC, "sEtUp")).toMatchObject({
      ok: true,
      section: { heading: "Setup" },
    });
  });

  it("prefers the EXACT match when a document holds both cases", () => {
    const body = "## Setup\na\n## setup\nb\n";
    expect(findSection(body, "setup")).toMatchObject({
      ok: true,
      section: { heading: "setup" },
    });
    expect(findSection(body, "Setup")).toMatchObject({
      ok: true,
      section: { heading: "Setup" },
    });
  });

  it("an unknown heading is SECTION_NOT_FOUND", () => {
    expect(findSection(DOC, "Nope")).toEqual({ ok: false, reason: "SECTION_NOT_FOUND" });
  });

  it("two identical headings REFUSE, naming both positions", () => {
    const body = "## Notes\nfirst\n## Notes\nsecond\n";
    const found = findSection(body, "Notes");
    expect(found.ok).toBe(false);
    if (found.ok) throw new Error("unreachable");
    expect(found.reason).toBe("SECTION_AMBIGUOUS");
    expect(found.matches.map((m) => [m.line, m.start])).toEqual([
      [1, 0],
      [3, 15],
    ]);
  });

  it("a case-INSENSITIVE collision refuses too", () => {
    const found = findSection("## Notes\na\n## notes\nb\n", "NOTES");
    expect(found).toMatchObject({ ok: false, reason: "SECTION_AMBIGUOUS" });
  });

  it("headings that differ only by level are two different sections, not a collision", () => {
    const found = findSection("## A\nx\n### A\ny\n", "A");
    expect(found).toMatchObject({ ok: false, reason: "SECTION_AMBIGUOUS" });
  });
});

describe("sliceSection", () => {
  it("returns the heading plus its content", () => {
    expect(sliceSection(DOC, "Usage")).toMatchObject({ text: "## Usage\ncall it\n" });
  });

  it("a ## section carries its ### children with it", () => {
    expect(sliceSection(DOC, "Setup")).toMatchObject({
      text: "## Setup\ninstall it\n\n### Windows\nrun the exe\n\n",
    });
  });

  it("the top-level heading carries the whole document", () => {
    expect(sliceSection(DOC, "Title")).toMatchObject({ text: DOC });
  });

  it("propagates the failure rather than returning an empty slice", () => {
    expect(sliceSection(DOC, "Nope")).toEqual({ ok: false, reason: "SECTION_NOT_FOUND" });
  });
});

describe("replaceSection", () => {
  it("replaces one section and leaves the rest byte-identical", () => {
    const out = replaceSection(DOC, "Usage", "run it\n");
    expect(out).toMatchObject({ ok: true });
    if (!out.ok) throw new Error("unreachable");
    expect(out.body).toBe(DOC.replace("call it\n", "run it\n"));
  });

  it("keeps the heading when the caller sends only prose", () => {
    const out = replaceSection("## A\nold\n## B\nkeep\n", "A", "new\n");
    expect(out).toMatchObject({ ok: true, body: "## A\nnew\n## B\nkeep\n" });
  });

  it("does NOT double the heading when the caller sends it back", () => {
    const out = replaceSection("## A\nold\n## B\nkeep\n", "A", "## A\nnew\n");
    expect(out).toMatchObject({ ok: true, body: "## A\nnew\n## B\nkeep\n" });
  });

  it("adds the newline a following section needs", () => {
    const out = replaceSection("## A\nold\n## B\nkeep\n", "A", "new");
    expect(out).toMatchObject({ ok: true, body: "## A\nnew\n## B\nkeep\n" });
  });

  it("does not invent a trailing newline on the LAST section", () => {
    const out = replaceSection("## A\nkeep\n## B\nold\n", "B", "new");
    expect(out).toMatchObject({ ok: true, body: "## A\nkeep\n## B\nnew" });
  });

  it("replacing a ## replaces its ### children with it", () => {
    const out = replaceSection(DOC, "Setup", "flattened\n");
    if (!out.ok) throw new Error("unreachable");
    expect(out.body).not.toContain("Windows");
    expect(out.body).toContain("## Usage");
  });

  it("works on a setext heading, keeping its underline", () => {
    const out = replaceSection("Title\n=====\nold\n", "Title", "new\n");
    expect(out).toMatchObject({ ok: true, body: "Title\n=====\nnew\n" });
  });

  it("refuses an ambiguous heading rather than overwriting the first", () => {
    expect(replaceSection("## N\na\n## N\nb\n", "N", "x")).toEqual({
      ok: false,
      reason: "SECTION_AMBIGUOUS",
      matches: expect.any(Array),
    });
  });

  it("refuses an unknown heading", () => {
    expect(replaceSection(DOC, "Nope", "x")).toEqual({
      ok: false,
      reason: "SECTION_NOT_FOUND",
    });
  });
});

describe("appendSection", () => {
  it("appends at ## level with a blank line before it", () => {
    expect(appendSection("body\n", "New", "content\n")).toBe("body\n\n## New\ncontent\n");
  });

  it("adds the newline a body without one is missing", () => {
    expect(appendSection("body", "New", "content")).toBe("body\n\n## New\ncontent\n");
  });

  it("an empty body gets the section alone", () => {
    expect(appendSection("", "New", "content")).toBe("## New\ncontent\n");
  });

  it("the appended section is findable, and is the last one", () => {
    const out = appendSection(DOC, "### Extra", "x");
    const { sections } = outlineOf(out);
    expect(sections[sections.length - 1]).toMatchObject({ heading: "Extra", level: 2 });
    expect(findSection(out, "Extra")).toMatchObject({ ok: true });
  });
});
