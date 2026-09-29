// @vitest-environment jsdom
/**
 * THE KB EDITOR'S TABLES (Samuel, 2026-09-29): the table scrolls sideways on
 * its own, and a cell edge under the pointer raises the rail's black pill,
 * which drags that column or row. Sizes are SESSION-ONLY: they never touch the
 * document, so the markdown agents read over MCP is byte-identical.
 *
 * ⚠ jsdom has no layout: `getBoundingClientRect` is stubbed per element from a
 * fixed grid (2 columns × 2 rows, 100px × 30px, origin 0,0).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { DocTable } from "./doc-editor-table";
import { TABLE_SCROLL_CLASS, edgeAt } from "./table-view";
import { fitWidths, pillLength, TABLE_COL_MIN } from "./table-sizing";

const HTML =
  "<p>above</p><table><tr><th>a</th><th>b</th></tr><tr><td>c</td><td>d</td></tr></table><p>below</p>";
const W = 100;
const H = 30;

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
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
  const table = scroller.querySelector("table") as HTMLTableElement;
  // Layout stub: cell (r, c) is W×H at (c·W, r·H); rows and the scroller follow.
  const rect = (l: number, t: number, w: number, h: number) =>
    ({ left: l, top: t, right: l + w, bottom: t + h, width: w, height: h, x: l, y: t }) as DOMRect;
  Array.from(table.rows).forEach((tr, r) => {
    vi.spyOn(tr, "getBoundingClientRect").mockReturnValue(rect(0, r * H, 2 * W, H));
    Array.from(tr.cells).forEach((td, c) =>
      vi.spyOn(td, "getBoundingClientRect").mockReturnValue(rect(c * W, r * H, W, H))
    );
  });
  vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue(rect(0, 0, 2 * W, 2 * H));
  const strip = scroller.querySelector("[data-table-resize]") as HTMLDivElement;
  return { scroller, table, strip, editor: editor! };
}

function pointer(target: Element, type: string, x: number, y: number) {
  target.dispatchEvent(
    new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true })
  );
}

describe("scroll containment", () => {
  it("wraps every table in its own horizontal scroller, prose outside it", () => {
    const { scroller, table } = mount();
    expect(scroller.className).toBe(TABLE_SCROLL_CLASS);
    expect(scroller.className).toContain("overflow-x-auto");
    expect(scroller.firstElementChild).toBe(table);
    expect(scroller.textContent).not.toContain("above");
    expect(scroller.textContent).not.toContain("below");
  });

  it("wraps in read-only too", () => {
    const { scroller } = mount(false);
    expect(scroller).not.toBeNull();
  });

  it("the document body never scrolls sideways", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync(
      "src/features/knowledge/components/knowledge-v2/knowledge-v2.module.css",
      "utf8"
    );
    const block = css.slice(css.indexOf(".docBody {"), css.indexOf("}", css.indexOf(".docBody {")));
    expect(block).toContain("overflow-x: hidden");
    expect(block).toContain("min-width: 0");
  });

  it("serialises without the wrapper — the markdown round-trip is unchanged", () => {
    const { editor } = mount();
    expect(editor.getHTML()).not.toContain("doc-table-scroll");
    expect(editor.getHTML()).toContain("<table");
  });
});

describe("edge detection", () => {
  const r = { left: 0, right: 100, top: 0, bottom: 30 };
  it("finds the right and bottom edges within the zone", () => {
    expect(edgeAt(r, 97, 15, { col: true, row: true })).toEqual({ axis: "col", side: "after" });
    expect(edgeAt(r, 50, 28, { col: true, row: true })).toEqual({ axis: "row", side: "after" });
    expect(edgeAt(r, 50, 15, { col: false, row: false })).toBeNull();
  });
  it("ignores the table's outer left/top border", () => {
    expect(edgeAt(r, 2, 15, { col: true, row: true })).toBeNull();
    expect(edgeAt(r, 2, 15, { col: false, row: true })).toEqual({ axis: "col", side: "before" });
  });
  it("sizes the pill to the segment, capped at the rail pill's 40px", () => {
    expect(pillLength(30)).toBe(18);
    expect(pillLength(400)).toBe(40);
    expect(pillLength(5)).toBe(12);
  });
  it("fits stored widths to a changed column count", () => {
    expect(fitWidths([100, 200], 3)).toEqual([100, 200, 150]);
    expect(fitWidths([100, 200, 300], 2)).toEqual([100, 200]);
  });
});

describe("resize handles", () => {
  it("hovering a vertical border shows the pill on THAT cell's segment", () => {
    const { table, strip } = mount();
    pointer(table.rows[1].cells[0], "pointermove", W - 2, H + 10);
    expect(strip.hidden).toBe(false);
    expect(strip.getAttribute("aria-orientation")).toBe("vertical");
    expect(strip.style.cursor).toBe("col-resize");
    expect(strip.style.top).toBe(`${H}px`);
    expect(strip.style.height).toBe(`${H}px`);
    const pill = strip.querySelector("[data-resize-pill]") as HTMLElement;
    expect(pill.className).toContain("bg-text-primary");
    expect(pill.className).toContain("rounded-full");
  });

  it("dragging a column edge resizes that column without touching the document", () => {
    const { table, strip, editor } = mount();
    const before = editor.getHTML();
    const onUpdate = vi.fn();
    editor.on("update", onUpdate);
    pointer(table.rows[0].cells[0], "pointermove", W - 1, 10);
    pointer(strip, "pointerdown", W, 10);
    pointer(strip, "pointermove", W + 60, 10);
    pointer(strip, "pointerup", W + 60, 10);
    const cols = table.querySelectorAll("col");
    expect((cols[0] as HTMLElement).style.width).toBe(`${W + 60}px`);
    expect((cols[1] as HTMLElement).style.width).toBe(`${W}px`);
    expect(table.style.tableLayout).toBe("fixed");
    expect(table.style.width).toBe(`${2 * W + 60}px`);
    expect(editor.getHTML()).toBe(before);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("a column never drags below the floor", () => {
    const { table, strip } = mount();
    pointer(table.rows[0].cells[1], "pointermove", W + 2, 10); // left edge of col 1 = col 0's edge
    pointer(strip, "pointerdown", W, 10);
    pointer(strip, "pointermove", -500, 10);
    const col0 = table.querySelector("col") as HTMLElement;
    expect(col0.style.width).toBe(`${TABLE_COL_MIN}px`);
  });

  it("hovering a horizontal border shows a row pill; dragging sets that row's height", () => {
    const { table, strip, editor } = mount();
    const before = editor.getHTML();
    pointer(table.rows[0].cells[1], "pointermove", W + 50, H - 1);
    expect(strip.hidden).toBe(false);
    expect(strip.getAttribute("aria-orientation")).toBe("horizontal");
    expect(strip.style.cursor).toBe("row-resize");
    expect(strip.style.left).toBe(`${W}px`);
    expect(strip.style.width).toBe(`${W}px`);
    pointer(strip, "pointerdown", W + 50, H);
    pointer(strip, "pointermove", W + 50, H + 25);
    expect(table.rows[0].style.height).toBe(`${H + 25}px`);
    expect(table.rows[1].style.height).toBe("");
    expect(editor.getHTML()).toBe(before);
  });

  it("read-only shows no handle", () => {
    const { table, strip } = mount(false);
    pointer(table.rows[1].cells[0], "pointermove", W - 2, H + 10);
    expect(strip.hidden).toBe(true);
  });

  it("away from a border, no handle", () => {
    const { table, strip } = mount();
    pointer(table.rows[1].cells[0], "pointermove", W / 2, H + H / 2);
    expect(strip.hidden).toBe(true);
  });
});
