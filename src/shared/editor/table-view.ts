/**
 * THE KB EDITOR'S TABLE: ITS OWN HORIZONTAL SCROLLER (Samuel, 2026-09-29:
 * *"make it so that just the table can be scrolled left to right. So the other
 * portions still stay fixed"*).
 *
 * ⚠ **THE WRAPPER IS THE SCROLLER, SO NOTHING ABOVE IT EVER IS.** A table wider
 * than the column used to push `.docBody` into a sideways scroll that carried
 * every paragraph with it. `overflow-x: auto` here keeps the overflow inside the
 * table's own box; the prose around it never moves.
 *
 * ⚠ **NO RESIZING, BY RULING** (Samuel, 2026-09-29: *"the user doesn't need to
 * size or resize … Everything is done by agents via mcp"*). Column widths come
 * from ONE CSS rule on the content (`doc-editor.tsx › PROSE_CLASSES`, "table
 * auto-sizing"); nothing is stored, so the markdown is untouched.
 *
 * ⚠ **THE WRAPPER IS OURS, NOT PROSEMIRROR'S** — `ignoreMutation` keeps PM from
 * re-reading the table over anything outside `<tbody>`.
 */

import type { Node as PMNode } from "@tiptap/pm/model";
import type { NodeView } from "@tiptap/pm/view";

/** The scroller. The vertical margin replaces the table's own `my-3`. */
export const TABLE_SCROLL_CLASS = "doc-table-scroll my-3 overflow-x-auto";

export class TableScrollView implements NodeView {
  dom: HTMLDivElement;
  contentDOM: HTMLTableSectionElement;

  constructor(private node: PMNode) {
    this.dom = document.createElement("div");
    this.dom.className = TABLE_SCROLL_CLASS;
    const table = this.dom.appendChild(document.createElement("table"));
    this.contentDOM = table.appendChild(document.createElement("tbody"));
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    return true;
  }

  ignoreMutation(
    mutation: MutationRecord | { type: "selection"; target: Node }
  ): boolean {
    if (mutation.type === "selection") return false;
    return !this.contentDOM.contains(mutation.target);
  }
}
