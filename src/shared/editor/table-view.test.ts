// @vitest-environment jsdom
/**
 * THE KB EDITOR'S TABLES (Samuel, 2026-09-29): a table scrolls sideways in its
 * own box so the prose never moves, and column widths come from ONE CSS
 * auto-sizing rule — no resizing, nothing stored, markdown untouched.
 */

import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { DocTable } from "./doc-editor-table";
import { TABLE_SCROLL_CLASS } from "./table-view";
import { TABLE_AUTOSIZE } from "./doc-editor";

const HTML =
  "<p>above</p><table><tr><th>a</th><th>b</th></tr><tr><td>c</td><td>d</td></tr></table><p>below</p>";

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
  document.body.innerHTML = "";
});

function mount(editable = true) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  editor = new Editor({
    element: el,
    extensions: [StarterKit, DocTable, TableRow, TableHeader, TableCell],
    content: HTML,
    editable,
  });
  const scroller = el.querySelector(".doc-table-scroll") as HTMLDivElement;
  return { scroller, editor: editor! };
}

describe("scroll containment", () => {
  it("wraps every table in its own horizontal scroller, prose outside it", () => {
    const { scroller } = mount();
    expect(scroller.className).toBe(TABLE_SCROLL_CLASS);
    expect(scroller.className).toContain("overflow-x-auto");
    expect(scroller.firstElementChild?.tagName).toBe("TABLE");
    expect(scroller.textContent).not.toContain("above");
    expect(scroller.textContent).not.toContain("below");
  });

  it("wraps in read-only too", () => {
    expect(mount(false).scroller).not.toBeNull();
  });

  it("the document body never scrolls sideways", () => {
    const css = readFileSync(
      "src/features/knowledge/components/knowledge-v2/knowledge-v2.module.css",
      "utf8"
    );
    const at = css.indexOf(".docBody {");
    const block = css.slice(at, css.indexOf("}", at));
    expect(block).toContain("overflow-x: hidden");
    expect(block).toContain("min-width: 0");
  });

  it("serialises without the wrapper — the markdown round-trip is unchanged", () => {
    const html = mount().editor.getHTML();
    expect(html).not.toContain("doc-table-scroll");
    expect(html).toContain("<table");
  });
});

describe("no resizing", () => {
  it("renders no handle and stores no size", () => {
    const { scroller, editor } = mount();
    expect(scroller.querySelector("[data-resize-pill], [role=separator]")).toBeNull();
    expect(scroller.querySelector("colgroup")).toBeNull();
    expect(scroller.querySelector("table")!.getAttribute("style")).toBeNull();
    expect(editor.getHTML()).not.toContain("colwidth");
  });
});

describe("auto-sizing rule", () => {
  it("is content-driven, bounded 6ch–40ch per cell, wrapping and top-aligned", () => {
    expect(TABLE_AUTOSIZE).toContain("[&_table]:table-auto");
    for (const cell of ["td", "th"]) {
      expect(TABLE_AUTOSIZE).toContain(`[&_${cell}>*]:min-w-[6ch]`);
      expect(TABLE_AUTOSIZE).toContain(`[&_${cell}>*]:max-w-[40ch]`);
      expect(TABLE_AUTOSIZE).toContain(`[&_${cell}]:break-words`);
      expect(TABLE_AUTOSIZE).toContain(`[&_${cell}]:align-top`);
    }
  });
});
