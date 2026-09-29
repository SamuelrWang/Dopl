/**
 * TABLE COLUMN WIDTHS AND ROW HEIGHTS, AS DECORATIONS — NEVER AS DOCUMENT
 * (Samuel, 2026-09-29: *"we also need to make a way to resize columns and
 * rows"*).
 *
 * ⚠ **SESSION-ONLY, AND THAT IS THE STORAGE FORMAT'S ANSWER, NOT A SHORTCUT.**
 * An entry is stored as MARKDOWN (`doc-editor.tsx`: `marked` in, `turndown`
 * out) and agents read and write exactly that over MCP. A GFM pipe table has
 * no place for a width or a height, so a size written into the document would
 * either vanish on the next save or change the format agents see. Sizes live
 * in this plugin's state instead: a meta-only transaction, so no `docChanged`,
 * no Tiptap `update`, no `onChange`, no autosave and no undo step. They map
 * through edits and are gone on a reload of the entry.
 *
 * Two decoration kinds, both `Decoration.node`:
 * - `cols` on a TABLE — `spec.widths`, read by `table-view.ts › TableScrollView`
 *   (a table's column widths belong on its `<colgroup>`, which only the node
 *   view owns);
 * - `row` on a TABLE ROW — a plain `style="height: …px"`, which PM patches onto
 *   the `<tr>` in place. A row's CSS height is a floor: content still grows it.
 */

import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

/** The narrowest a dragged column gets — its 24px of padding plus a word. */
export const TABLE_COL_MIN = 56;

export type TableSizeMeta =
  | { kind: "cols"; pos: number; widths: number[] }
  | { kind: "row"; pos: number; height: number };

export const tableSizingKey = new PluginKey<DecorationSet>("docTableSizing");

/** The table decoration's widths, or `null` when the table was never resized. */
export function colWidthsFrom(
  decorations: readonly Decoration[]
): number[] | null {
  for (const d of decorations) {
    const spec = d.spec as { kind?: string; widths?: number[] } | undefined;
    if (spec?.kind === "cols" && Array.isArray(spec.widths)) return spec.widths;
  }
  return null;
}

/** Fit a stored width list to the table's CURRENT column count: a column
 *  added after a resize takes the mean, a removed one drops off the end. */
export function fitWidths(widths: number[], count: number): number[] {
  if (widths.length === count) return widths;
  if (widths.length > count) return widths.slice(0, count);
  const mean = Math.round(
    widths.reduce((a, b) => a + b, 0) / Math.max(1, widths.length)
  );
  return [
    ...widths,
    ...Array.from({ length: count - widths.length }, () =>
      Math.max(TABLE_COL_MIN, mean || TABLE_COL_MIN)
    ),
  ];
}

export function clampColWidth(width: number): number {
  return Math.max(TABLE_COL_MIN, Math.round(width));
}

export function clampRowHeight(height: number, contentMin: number): number {
  return Math.max(Math.ceil(contentMin), Math.round(height));
}

/** The pill's length for a cell edge `segment` px long: centred ON that
 *  segment, never longer than the file rail's 40px pill, never a dot. */
export function pillLength(segment: number): number {
  return Math.min(40, Math.max(12, Math.round(segment * 0.6)));
}

function replaceAt(
  set: DecorationSet,
  tr: Transaction,
  meta: TableSizeMeta
): DecorationSet {
  const node = tr.doc.nodeAt(meta.pos);
  if (!node) return set;
  const to = meta.pos + node.nodeSize;
  const stale = set.find(
    meta.pos,
    to,
    (spec) => (spec as { kind?: string }).kind === meta.kind
  );
  const next = set.remove(stale.filter((d) => d.from === meta.pos));
  const deco =
    meta.kind === "cols"
      ? Decoration.node(meta.pos, to, {}, { kind: "cols", widths: meta.widths })
      : Decoration.node(
          meta.pos,
          to,
          { style: `height: ${meta.height}px` },
          { kind: "row", height: meta.height }
        );
  return next.add(tr.doc, [deco]);
}

export function tableSizingPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: tableSizingKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set) {
        const mapped = set.map(tr.mapping, tr.doc);
        const meta = tr.getMeta(tableSizingKey) as TableSizeMeta | undefined;
        return meta ? replaceAt(mapped, tr, meta) : mapped;
      },
    },
    props: {
      decorations: (state) => tableSizingKey.getState(state),
    },
  });
}

/** One size write — meta only, so the document (and the markdown) is untouched. */
export function dispatchTableSize(view: EditorView, meta: TableSizeMeta): void {
  view.dispatch(
    view.state.tr.setMeta(tableSizingKey, meta).setMeta("addToHistory", false)
  );
}
