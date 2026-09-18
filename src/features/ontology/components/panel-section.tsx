"use client";

import { useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { PANEL_ROWS, PANEL_WELL } from "@/shared/ui/panel-well";
import { SMALL_TEXT_BUTTON } from "@/shared/ui/small-action-button";

/**
 * The well and the rows' column live in `shared/ui/panel-well.ts` (the Agents tab
 * wears the same well, and `docs/INVARIANTS.md` §1 forbids `channels → ontology`).
 * Re-exported here so this stays the import path of record for `ontology/`.
 */
export { PANEL_ROWS, PANEL_WELL };

/**
 * The object panel's section: an uppercase label, flat and flush left, over a gray
 * well of white row bars (Samuel, 2026-09-12 and 2026-09-13).
 *
 * No frame — `shared/ui/section-box.tsx › SectionBox`'s box around the label is
 * what 2026-09-12 deleted. This is the frame model's alternation
 * (docs/DESIGN-SYSTEM.md § the three grounds): level 3 well, level 2 card.
 *
 * No count (Samuel, 2026-09-13). The `meta` prop is deleted rather than left
 * unpassed, because an optional slot beside the label is how the number returns.
 *
 * The label is an `h3`, so each section is reachable by role — which is what the
 * History pin (`pages/home/ontology-panels.test.tsx`) matches on.
 */
export function PanelSection({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    // The section is the well and the label sits inside it, as the /home Overview's
    // Token-spend panel does (Samuel, 2026-09-13). Same header row geometry as
    // `shared/ui/section-panel.tsx › SectionPanel`.
    <section className={PANEL_WELL}>
      <div className="flex min-h-[22px] items-center px-1 pb-0.5">
        <h3 className="truncate text-label font-semibold uppercase tracking-wide text-text-secondary">
          {label}
        </h3>
      </div>
      {children}
    </section>
  );
}

/**
 * One row = one white bar on that well — `.bento`, the same class the Token-spend
 * panel's white face wears. Fill, hairline, radius and shadow are the class's; the
 * caller composes direction and gaps, so an attribute's one-line row and an
 * action's four-field stack are the same bar.
 *
 * Fields sit on the bar, not in wells of their own: every input is the popup kit's
 * underline (`board-header-bits.tsx › InlineUnderlineField`) and every picker a
 * `SelectMenu` text face, so the bar adds a surface, never an indent.
 */
export const PANEL_ROW = "bento min-w-0 px-2.5 py-2";

/**
 * The row's remove ✕ — naked, revealed on the row's hover. One declaration for all
 * four editors. Pair it with `group` on the row itself.
 */
export const ROW_REMOVE_BUTTON =
  "rounded-md p-1 text-text-muted opacity-0 transition " +
  "hover:bg-surface-raised-3 hover:text-text-primary group-hover:opacity-100";

/**
 * `+ Add` — under the rows, inside the well, appending an empty row rather than
 * opening a composer (Samuel, 2026-09-13): every cell of the new row is there from
 * the moment it appears. One accessible name, "Add", in all four sections.
 */
export function PanelAddButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(SMALL_TEXT_BUTTON, "gap-1 self-start")}
    >
      <Plus size={11} /> Add
    </button>
  );
}

/**
 * The rows that are not saved yet. An unnamed row has no address — an attribute's
 * `key` is its label slugged, a relationship is addressed by label in the reducer
 * (`graph-state.ts › RELATIONSHIP_SET`, which also drops edges with no targets) —
 * so it waits here and dispatches the moment it has a name (an edge: a target).
 *
 * Key the rendered rows BY POSITION (`row-${i}` over the persisted rows,
 * `row-${persisted.length + n}` over these): a committed draft then lands at the
 * index it was drawn at and React reconciles the same subtree instead of
 * unmounting the row under the caret. Keys off the data drop the caret mid-word.
 */
export function useDraftRows<T>(blank: () => T) {
  const [drafts, setDrafts] = useState<T[]>([]);
  return {
    drafts,
    add: () => setDrafts((rows) => [...rows, blank()]),
    patch: (index: number, next: T) =>
      setDrafts((rows) => rows.map((row, i) => (i === index ? next : row))),
    drop: (index: number) =>
      setDrafts((rows) => rows.filter((_, i) => i !== index)),
  };
}
