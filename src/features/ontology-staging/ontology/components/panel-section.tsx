"use client";

import { useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { SMALL_TEXT_BUTTON } from "@/shared/ui/small-action-button";

/**
 * One section of the object panel: a muted caption title over hairline rows that sit directly on
 * the panel's white card. The title is an `h3`, so each section is reachable by role.
 */
export function PanelSection({
  label,
  caption,
  children,
}: {
  label: string;
  /** One line under the title, for a fact the rows cannot state. */
  caption?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col">
      <h3 className="pb-1 text-caption font-medium text-text-muted">{label}</h3>
      {caption && <p className="pb-1 text-caption text-text-muted">{caption}</p>}
      {children}
    </section>
  );
}

/** The rows' column: each row draws its own leading hairline, kept off the first. */
export const PANEL_ROWS = "flex min-w-0 flex-col";

/** One row's line: the hairline above it (none on the first) and the row's own height. */
export const PANEL_ROW = "group min-w-0 border-t border-border-subtle py-1 first:border-t-0";

/**
 * The label / value grid every keyed row uses (attributes, default fields, relationships): a fixed
 * label column, then the value with its trailing controls. A hint takes the value column's second
 * line.
 */
export const PANEL_GRID = "grid grid-cols-[104px_minmax(0,1fr)] items-center gap-x-3";

/** A quiet glyph button inside a row (the link's pencil, a chip's remove). */
export const ROW_ICON_BUTTON =
  "shrink-0 rounded-md p-1 text-text-muted transition-colors hover:text-text-primary";

/** The row's remove ✕ and ⋯: revealed on the row's hover or on focus. Pair with `group` on the row. */
export const ROW_REMOVE_BUTTON = cn(
  ROW_ICON_BUTTON,
  "opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
);

/** `+ Add` under the rows, appending an empty row. One accessible name, "Add", in every section. */
export function PanelAddButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(SMALL_TEXT_BUTTON, "-ml-2.5 gap-1 self-start text-text-muted")}
    >
      <Plus size={11} /> Add
    </button>
  );
}

/**
 * The rows that are not saved yet. An unnamed row has no address (an attribute's `key` is its
 * label slugged; an edge is addressed by label), so it waits here and is dispatched once it has one.
 *
 * Key rendered rows BY POSITION (`row-${i}` over the persisted rows, `row-${persisted.length + n}`
 * over these): a committed draft then lands at the index it was drawn at and React keeps the same
 * subtree, so the caret stays put.
 */
export function useDraftRows<T>(blank: () => T) {
  const [drafts, setDrafts] = useState<T[]>([]);
  return {
    drafts,
    add: () => setDrafts((rows) => [...rows, blank()]),
    patch: (index: number, next: T) =>
      setDrafts((rows) => rows.map((row, i) => (i === index ? next : row))),
    drop: (index: number) => setDrafts((rows) => rows.filter((_, i) => i !== index)),
  };
}
