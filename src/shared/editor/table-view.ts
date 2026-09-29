/**
 * THE KB EDITOR'S TABLE: ITS OWN HORIZONTAL SCROLLER, AND A DRAG PILL ON THE
 * CELL EDGE UNDER THE POINTER (Samuel, 2026-09-29: *"make it so that just the
 * table can be scrolled left to right. So the other portions still stay fixed
 * … when a user is hovering over a borderline, a black line … appears in the
 * center of that segment specifically of the cell belong to that edge. And
 * then, the user can drag it"*).
 *
 * ⚠ **THE WRAPPER IS THE SCROLLER, SO NOTHING ABOVE IT EVER IS.** A table wider
 * than the column used to push `.docBody` into a sideways scroll that carried
 * every paragraph with it. `overflow-x: auto` here keeps the overflow inside
 * the table's own box; the prose around it never moves.
 *
 * ⚠ **THE PILL IS THE FILE RAIL'S PILL** (`shared/ui/split-resize-handle.tsx ›
 * RESIZE_PILL_CLASS`), sized to ONE cell's edge: only that segment, never the
 * whole column or row. It exists only while the editor is editable.
 *
 * ⚠ **EVERYTHING OUTSIDE `<tbody>` IS OURS, NOT PROSEMIRROR'S** — the wrapper,
 * `<colgroup>`, the strip. `ignoreMutation` says so, or PM would re-read the
 * table on every hover; `stopEvent` keeps a press on the strip from becoming a
 * cell selection.
 */

import type { Node as PMNode } from "@tiptap/pm/model";
import type { Decoration, EditorView, NodeView } from "@tiptap/pm/view";
import { TableMap } from "@tiptap/pm/tables";
import { RESIZE_PILL_CLASS } from "@/shared/ui/split-resize-handle";
import {
  clampColWidth,
  clampRowHeight,
  colWidthsFrom,
  dispatchTableSize,
  fitWidths,
  pillLength,
} from "./table-sizing";

/** The scroller. `-mx/px` give the edge strip 6px to live in at the table's
 *  outer edges without spilling a scrollbar; the table still aligns with the
 *  prose. The vertical padding replaces the table's own `my-3`. */
export const TABLE_SCROLL_CLASS =
  "doc-table-scroll relative -mx-1.5 my-1.5 overflow-x-auto overflow-y-hidden p-1.5";

/** How near a border (either side) the pointer must be to raise the pill. */
export const EDGE_ZONE = 5;
/** The strip's thickness — the pill's hit area, centred on the border. */
const STRIP = 10;

type Axis = "col" | "row";
interface Hit {
  axis: Axis;
  /** The cell whose edge it is — the pill is centred on THIS cell's side. */
  cell: HTMLTableCellElement;
  /** Which side of that cell: the column/row boundary is AFTER it or BEFORE it. */
  side: "before" | "after";
}

/** Which of `rect`'s edges the point is on, if any. `before` edges of the
 *  first column/row are the table's outer border and resize nothing. */
export function edgeAt(
  rect: { left: number; right: number; top: number; bottom: number },
  x: number,
  y: number,
  first: { col: boolean; row: boolean }
): { axis: Axis; side: "before" | "after" } | null {
  const cands: { axis: Axis; side: "before" | "after"; d: number }[] = [
    { axis: "col", side: "after", d: Math.abs(rect.right - x) },
    { axis: "row", side: "after", d: Math.abs(rect.bottom - y) },
  ];
  if (!first.col) cands.push({ axis: "col", side: "before", d: Math.abs(x - rect.left) });
  if (!first.row) cands.push({ axis: "row", side: "before", d: Math.abs(y - rect.top) });
  const near = cands.filter((c) => c.d <= EDGE_ZONE).sort((a, b) => a.d - b.d);
  return near[0] ? { axis: near[0].axis, side: near[0].side } : null;
}

/** Column index where `cell` starts, counting spans before it. */
function colStart(cell: HTMLTableCellElement): number {
  let col = 0;
  let prev = cell.previousElementSibling as HTMLTableCellElement | null;
  while (prev) {
    col += prev.colSpan || 1;
    prev = prev.previousElementSibling as HTMLTableCellElement | null;
  }
  return col;
}

/** A cell's content height — the floor a dragged row cannot go under. */
function contentHeight(cell: HTMLElement): number {
  const cs = getComputedStyle(cell);
  const pad =
    (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  const kids = Array.from(cell.children) as HTMLElement[];
  if (kids.length === 0) return pad;
  const first = kids[0];
  const last = kids[kids.length - 1];
  const mt = parseFloat(getComputedStyle(first).marginTop) || 0;
  const mb = parseFloat(getComputedStyle(last).marginBottom) || 0;
  const span =
    last.getBoundingClientRect().bottom + mb - (first.getBoundingClientRect().top - mt);
  return pad + span;
}

export class TableScrollView implements NodeView {
  dom: HTMLDivElement;
  contentDOM: HTMLTableSectionElement;
  private table: HTMLTableElement;
  private colgroup: HTMLTableColElement;
  private strip: HTMLDivElement;
  private pill: HTMLSpanElement;
  private hit: Hit | null = null;
  private dragging = false;

  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined,
    decorations: readonly Decoration[]
  ) {
    this.dom = document.createElement("div");
    this.dom.className = TABLE_SCROLL_CLASS;
    this.table = this.dom.appendChild(document.createElement("table"));
    this.colgroup = this.table.appendChild(document.createElement("colgroup"));
    this.contentDOM = this.table.appendChild(document.createElement("tbody"));

    this.strip = this.dom.appendChild(document.createElement("div"));
    this.strip.setAttribute("data-table-resize", "");
    this.strip.setAttribute("role", "separator");
    this.strip.contentEditable = "false";
    this.strip.hidden = true;
    this.strip.className = "absolute z-[2] flex touch-none items-center justify-center";
    this.pill = this.strip.appendChild(document.createElement("span"));
    this.pill.setAttribute("data-resize-pill", "");
    this.pill.className = `pointer-events-none ${RESIZE_PILL_CLASS}`;

    this.applyWidths(decorations);
    this.dom.addEventListener("pointermove", this.onHover);
    this.dom.addEventListener("pointerleave", this.onLeave);
    this.strip.addEventListener("pointerdown", this.onDown);
  }

  update(node: PMNode, decorations: readonly Decoration[]): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.applyWidths(decorations);
    if (this.hit && !this.hit.cell.isConnected) this.hide();
    return true;
  }

  /** Column widths from the sizing decoration: a resized table is FIXED
   *  layout at exactly the sum; an unsized one is the prose default. */
  private applyWidths(decorations: readonly Decoration[]): void {
    const count = TableMap.get(this.node).width;
    const stored = colWidthsFrom(decorations);
    const widths = stored ? fitWidths(stored, count) : null;
    while (this.colgroup.children.length < count) {
      this.colgroup.appendChild(document.createElement("col"));
    }
    while (this.colgroup.children.length > count) {
      this.colgroup.lastElementChild?.remove();
    }
    Array.from(this.colgroup.children).forEach((col, i) => {
      (col as HTMLElement).style.width = widths ? `${widths[i]}px` : "";
    });
    if (widths) {
      this.table.style.width = `${widths.reduce((a, b) => a + b, 0)}px`;
      this.table.style.tableLayout = "fixed";
      this.table.setAttribute("data-sized", "");
    } else {
      this.table.style.width = "";
      this.table.style.tableLayout = "";
      this.table.removeAttribute("data-sized");
    }
  }

  private onHover = (event: PointerEvent): void => {
    if (this.dragging) return;
    const target = event.target as Element | null;
    if (!target || this.strip.contains(target)) return;
    if (!this.view.editable) return this.hide();
    const cell = target.closest("td, th") as HTMLTableCellElement | null;
    if (!cell || !this.table.contains(cell)) return this.hide();
    const row = cell.parentElement as HTMLTableRowElement;
    const edge = edgeAt(cell.getBoundingClientRect(), event.clientX, event.clientY, {
      col: colStart(cell) === 0,
      row: row.rowIndex === 0,
    });
    if (!edge) return this.hide();
    this.hit = { ...edge, cell };
    this.place();
  };

  private onLeave = (): void => {
    if (!this.dragging) this.hide();
  };

  private hide(): void {
    this.hit = null;
    this.strip.hidden = true;
  }

  /** Put the strip on the hit cell's edge, centred, one segment long. */
  private place(): void {
    const hit = this.hit;
    if (!hit) return;
    const box = this.dom.getBoundingClientRect();
    const r = hit.cell.getBoundingClientRect();
    const ox = this.dom.scrollLeft - box.left;
    const oy = this.dom.scrollTop - box.top;
    const s = this.strip.style;
    const p = this.pill.style;
    if (hit.axis === "col") {
      const x = hit.side === "after" ? r.right : r.left;
      Object.assign(s, {
        left: `${x + ox - STRIP / 2}px`,
        top: `${r.top + oy}px`,
        width: `${STRIP}px`,
        height: `${r.height}px`,
        cursor: "col-resize",
      });
      Object.assign(p, { width: "4px", height: `${pillLength(r.height)}px` });
    } else {
      const y = hit.side === "after" ? r.bottom : r.top;
      Object.assign(s, {
        left: `${r.left + ox}px`,
        top: `${y + oy - STRIP / 2}px`,
        width: `${r.width}px`,
        height: `${STRIP}px`,
        cursor: "row-resize",
      });
      Object.assign(p, { height: "4px", width: `${pillLength(r.width)}px` });
    }
    this.strip.setAttribute("aria-orientation", hit.axis === "col" ? "vertical" : "horizontal");
    this.strip.hidden = false;
  }

  private onDown = (event: PointerEvent): void => {
    const hit = this.hit;
    if (event.button !== 0 || !hit || !this.view.editable) return;
    event.preventDefault();
    event.stopPropagation();
    this.strip.setPointerCapture?.(event.pointerId);
    const move = hit.axis === "col" ? this.colDrag(hit, event) : this.rowDrag(hit, event);
    if (!move) return;
    this.dragging = true;
    this.strip.setAttribute("data-dragging", "true");
    const onMove = (e: PointerEvent) => {
      move(e);
      this.place();
    };
    const onUp = () => {
      this.strip.removeEventListener("pointermove", onMove);
      this.strip.removeEventListener("pointerup", onUp);
      this.strip.removeEventListener("pointercancel", onUp);
      try {
        this.strip.releasePointerCapture?.(event.pointerId);
      } catch {
        // Already released, or never captured.
      }
      this.dragging = false;
      this.strip.removeAttribute("data-dragging");
    };
    this.strip.addEventListener("pointermove", onMove);
    this.strip.addEventListener("pointerup", onUp);
    this.strip.addEventListener("pointercancel", onUp);
  };

  /** Freeze every column at its rendered width, then move the one edge. */
  private colDrag(hit: Hit, down: PointerEvent) {
    const pos = this.getPos();
    if (pos === undefined) return null;
    const row = Array.from(this.table.rows).find((r) =>
      Array.from(r.cells).every((c) => (c.colSpan || 1) === 1)
    );
    if (!row) return null;
    const start = Array.from(row.cells).map((c) => c.getBoundingClientRect().width);
    const col =
      hit.side === "after" ? colStart(hit.cell) + (hit.cell.colSpan || 1) - 1 : colStart(hit.cell) - 1;
    if (col < 0 || col >= start.length) return null;
    return (e: PointerEvent) => {
      const widths = start.map(clampColWidth);
      widths[col] = clampColWidth(start[col] + e.clientX - down.clientX);
      dispatchTableSize(this.view, { kind: "cols", pos, widths });
    };
  }

  /** Grow or shrink the row above the edge, never under its content. */
  private rowDrag(hit: Hit, down: PointerEvent) {
    const cellRow = hit.cell.parentElement as HTMLTableRowElement;
    const tr =
      hit.side === "after" ? cellRow : this.table.rows[cellRow.rowIndex - 1];
    if (!tr) return null;
    const pos = this.view.posAtDOM(tr, 0) - 1;
    if (this.view.state.doc.nodeAt(pos)?.type.name !== "tableRow") return null;
    const startH = tr.getBoundingClientRect().height;
    const floor = Math.max(0, ...Array.from(tr.cells).map(contentHeight));
    return (e: PointerEvent) => {
      const height = clampRowHeight(startH + e.clientY - down.clientY, floor);
      dispatchTableSize(this.view, { kind: "row", pos, height });
    };
  }

  stopEvent(event: Event): boolean {
    return this.strip.contains(event.target as Node);
  }

  ignoreMutation(mutation: MutationRecord | { type: "selection"; target: Node }): boolean {
    if (mutation.type === "selection") return false;
    return !this.contentDOM.contains(mutation.target);
  }

  destroy(): void {
    this.dom.removeEventListener("pointermove", this.onHover);
    this.dom.removeEventListener("pointerleave", this.onLeave);
    this.strip.removeEventListener("pointerdown", this.onDown);
  }
}
