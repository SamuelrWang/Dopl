import { Table } from "@tiptap/extension-table";
import { TableScrollView } from "./table-view";

/**
 * The KB editor's table: Tiptap's `Table`, rendered through
 * `table-view.ts › TableScrollView` (its own horizontal scroller).
 *
 * ⚠ `resizable: false` STAYS: prosemirror-tables' column resizer writes
 * `colwidth` into the DOCUMENT, and tables are not user-sized (Samuel,
 * 2026-09-29). The node view is display only — `getHTML()` still serialises
 * through `renderHTML`, so the turndown → markdown round-trip is unchanged.
 */
export const DocTable = Table.extend({
  addNodeView() {
    return ({ node }) => new TableScrollView(node);
  },
}).configure({ resizable: false });
