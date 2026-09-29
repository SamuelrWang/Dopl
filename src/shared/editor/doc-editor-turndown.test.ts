// @vitest-environment jsdom
/**
 * THE KB EDITOR'S MARKDOWN ROUND-TRIP FOR TABLES (Samuel, 2026-09-29: yes to
 * fixing table cells losing their formatting on save). The pipeline is the
 * editor's own: `marked` (GFM) → Tiptap → `getHTML()` → `createDocTurndown`.
 *
 * Contract: markdown already in the editor's canonical form comes back
 * BYTE-EQUAL; anything else is normalised once and is then stable.
 */

import { afterEach, describe, expect, it } from "vitest";
import { marked } from "marked";
import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { Underline } from "@tiptap/extension-underline";
import { Link } from "@tiptap/extension-link";
import { TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { DocTable } from "./doc-editor-table";
import TurndownService from "turndown";
import {
  createDocTurndown,
  makeLinkRule,
  makeStrikeRule,
  toCellMarkdown,
} from "./doc-editor-turndown";

const editors: Editor[] = [];
afterEach(() => {
  editors.splice(0).forEach((e) => e.destroy());
});

const turndown = createDocTurndown();

/** One save: exactly what `DocEditor` does between load and `onChange`. */
function roundTrip(md: string): string {
  const html = marked.parse(md, { async: false, gfm: true }) as string;
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [
      StarterKit.configure({ link: false, underline: false }),
      Underline,
      Link.configure({ openOnClick: false }),
      DocTable,
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: html,
  });
  editors.push(editor);
  return turndown.turndown(editor.getHTML());
}

const CANONICAL = [
  "Intro with **bold** text.",
  "",
  "| Case | Example | Expected |",
  "| --- | --- | --- |",
  "| Link | [Even Realities](https://www.evenrealities.com) | Clickable |",
  "| Code | `dopl_write_entry(base=\"x\")` | Mono |",
  "| Bold | **important** and *italic* | Styled |",
  "| Strike | ~~old~~ new | Struck |",
  "| Long URL | [https://example.com/a/very/long/path/that/never/breaks?q=1&and=more](https://example.com/a/very/long/path/that/never/breaks?q=1&and=more) | Breaks |",
  "| Pipe | a \\| b | Escaped |",
  "| Pipe in code | `x \\| y` | Escaped |",
  "| Break | one<br>two | Two lines |",
  "| Empty |     | Blank |",
  "|     |     |     |",
  "",
  "Outro.",
].join("\n");

describe("table cells keep inline markdown on save", () => {
  it("canonical markdown round-trips byte-equal", () => {
    expect(roundTrip(CANONICAL)).toBe(CANONICAL);
  });

  it("is idempotent: the second save equals the first", () => {
    const once = roundTrip(CANONICAL);
    expect(roundTrip(once)).toBe(once);
  });

  it("keeps every formatting kind in a cell", () => {
    const out = roundTrip(CANONICAL);
    for (const piece of [
      "[Even Realities](https://www.evenrealities.com)",
      '`dopl_write_entry(base="x")`',
      "**important** and *italic*",
      "~~old~~ new",
      "a \\| b",
      "`x \\| y`",
      "one<br>two",
    ]) {
      expect(out).toContain(piece);
    }
  });

  it("keeps alignment in the delimiter row", () => {
    const md = "| L   | C   | R   | N   |\n| :--- | :---: | ---: | --- |\n| a   | b   | c   | d   |";
    expect(roundTrip(md)).toBe(md);
  });

  it("a bare URL is autolinked once (as in prose), then stable", () => {
    const md = "| u   |\n| --- |\n| https://x.dev/p?q=1 |";
    const once = roundTrip(md);
    expect(once).toContain("[https://x.dev/p?q=1](https://x.dev/p?q=1)");
    expect(roundTrip(once)).toBe(once);
  });

  it("normalises hand-written tables once, then is stable", () => {
    const loose = "|a|b|\n|-|-|\n|**x**|[y](https://y.dev)|";
    const once = roundTrip(loose);
    expect(once).toBe("| a   | b   |\n| --- | --- |\n| **x** | [y](https://y.dev) |");
    expect(roundTrip(once)).toBe(once);
  });

  it("two paragraphs in one cell become one <br>-joined line", () => {
    expect(toCellMarkdown("one\n\ntwo")).toBe("one<br>two");
    expect(toCellMarkdown("one  \ntwo")).toBe("one<br>two");
    expect(toCellMarkdown("a | b")).toBe("a \\| b");
  });
});

describe("non-table output is unchanged", () => {
  it("prose, lists, code and links serialise exactly as the pre-fix converter did", () => {
    // The pre-fix converter minus its table rule: same options, same link rule —
    // plus strike, the one deliberate non-table change (2026-09-29).
    const legacy = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
      bulletListMarker: "-",
      emDelimiter: "*",
      linkStyle: "inlined",
    });
    legacy.addRule("link", makeLinkRule());
    legacy.addRule("strike", makeStrikeRule());
    const html = marked.parse(
      [
        "# Title",
        "",
        "Para with [link](https://a.dev), `code`, **bold**, *em*, ~~gone~~ and a | pipe.",
        "",
        "- one",
        "- two",
        "",
        "> quote",
        "",
        "```",
        "block | with pipe",
        "```",
      ].join("\n"),
      { async: false, gfm: true }
    ) as string;
    expect(turndown.turndown(html)).toBe(legacy.turndown(html));
  });
});

describe("strikethrough in text survives save", () => {
  it.each([
    ["paragraph", "Keep ~~this~~ struck."],
    ["list item", "-   ~~done~~ task\n-   open task"],
    ["heading", "## ~~Old~~ New heading"],
    // ProseMirror's mark order puts strike inside bold and link — the canonical form.
    ["mixed with bold and link", "A **~~bold strike~~** and [~~link~~](https://a.dev) here."],
  ])("%s round-trips and is idempotent", (name, md) => {
    const once = roundTrip(md);
    expect(once).toContain("~~");
    expect(roundTrip(once)).toBe(once);
    // A list is re-spaced once by the pre-existing list output; the rest is byte-equal.
    if (name !== "list item") expect(once).toBe(md);
  });

  it("strike written outside bold/link is normalised once, then stable", () => {
    const once = roundTrip("A ~~**b**~~ and ~~[l](https://a.dev)~~.");
    expect(once).toBe("A **~~b~~** and [~~l~~](https://a.dev).");
    expect(roundTrip(once)).toBe(once);
  });
});
