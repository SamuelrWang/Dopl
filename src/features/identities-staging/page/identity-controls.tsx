"use client";

/**
 * SEARCH, SORT AND FILTER (item 3c, idea 5) — the grid's own controls, so they sit DIRECTLY above
 * the grid and not up in the page head with the page's conditions. A control belongs beside the
 * thing it changes; the scope control is up there because it changes what the page IS, and these
 * are down here because they only rearrange what is already on it.
 *
 * ITEM 7 rebuilt all three faces (2026-10-22). Rules are cited by NAME below; the numbered
 * source is `KB orchestration-guidelines › Plans/UI Standing Rules`, where blank space is Rule 1:
 *
 * 1. **The field is the app's own search pill**, not a bordered box — `./identity-search-field.tsx`
 *    wears /home's `.search-expand` recipe verbatim (*"Look at the other search bars. The other
 *    search bar is kind of rounded"*).
 * 2. **The menus have no pill**: `shared/ui/select-menu.tsx`'s `bare` face, label + chevron (*"For dropdowns, it
 *    should just be the arrow. We don't need the whole pill around it"*).
 * 3. **No `--bg-inset` anywhere on the row.** The old field and both menus were `bg-bg-inset`
 *    (`#f1f1f1`), the grey Samuel named: *"I don't like that gray color. I actually want to not
 *    use that gray color at all. That's what you see in the background of the search identities
 *    button"*. Nothing here carries a fill now, so there is no grey to ban.
 *
 * ⚠ **STILL NO KIT `SearchField`, AND THAT IS STILL A RULING.** It is `.concave-field`, and
 * concave surfaces are BANNED on /home — swept by
 * `agent-identities/components/identity-editor-surface.test.tsx`. The search pill is the /home
 * answer to that and is what this row uses.
 */

import { SelectMenu } from "@/shared/ui/select-menu";
import { IdentitySearchField } from "./identity-search-field";
import { STAGING_RUNTIMES } from "../data";
import { SORT_OPTIONS, type SortKey } from "./identity-page-data";

export function IdentityControls({
  query,
  onQuery,
  sort,
  onSort,
  runtime,
  onRuntime,
  showing,
  total,
}: {
  query: string;
  onQuery: (next: string) => void;
  sort: SortKey;
  onSort: (next: SortKey) => void;
  /** `"all"` or a runtime id. */
  runtime: string;
  onRuntime: (next: string) => void;
  /** How many rows survive the controls, and how many there were. Only drawn once something is
   *  actually filtered out: a count that always reads "8 of 8" is furniture. */
  showing: number;
  total: number;
}) {
  const filtered = showing !== total;
  return (
    <div className="flex min-w-0 items-center gap-4 px-1">
      <IdentitySearchField value={query} onChange={onQuery} />

      <SelectMenu
        variant="bare"
        value={runtime}
        options={[
          { value: "all", label: "Any runtime" },
          ...STAGING_RUNTIMES.map((r) => ({
            value: r.id,
            label: r.label ?? r.id,
            description: `Only identities that run on ${r.label ?? r.id}`,
          })),
        ]}
        onChange={onRuntime}
        ariaLabel="Filter by runtime"
      />

      <SelectMenu
        variant="bare"
        value={sort}
        options={SORT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        onChange={onSort}
        prefix="Sort"
        ariaLabel="Sort identities"
      />

      {/* ⚠ NO `ml-auto` (the Blank Space Rule). Pinned to the far right this count left a ~400px hole
          between the menus and itself at real pane width: one small item hugging an edge, which is
          the Blank Space Rule's point 2 exactly. The controls are not a container, so the row simply ends where
          its content does and the rest is page. */}
      {filtered && (
        <p className="flex-none text-caption text-text-muted">
          {showing} of {total}
        </p>
      )}
    </div>
  );
}
