import { Table } from "@tiptap/extension-table";
import { TableScrollView } from "./table-view";
import { tableSizingPlugin } from "./table-sizing";

/**
 * The KB editor's table: Tiptap's `Table`, rendered through
 * `table-view.ts › TableScrollView` (its own horizontal scroller + the cell-edge
 * drag pill) and carrying `table-sizing.ts`'s session-only sizes.
 *
 * ⚠ `resizable: false` STAYS: prosemirror-tables' column resizer writes
 * `colwidth` into the DOCUMENT (a doc change → an autosave of identical
 * markdown) and highlights the whole column. Ours does neither. The node view
 * is display only — `getHTML()` still serialises through `renderHTML`, so the
 * turndown → markdown round-trip is unchanged.
 */
export const DocTable = Table.extend({
  addNodeView() {
    return ({ node, view, getPos, decorations }) =>
      new TableScrollView(node, view, getPos, decorations);
  },
  addProseMirrorPlugins() {
    return [...(this.parent?.() ?? []), tableSizingPlugin()];
  },
}).configure({ resizable: false });
