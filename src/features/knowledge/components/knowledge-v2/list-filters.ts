import { kbScope, type KbScope } from "../../scope";
import type { KnowledgeBase } from "../../types";
import type { ListFilter } from "./types";

/**
 * The scope filter row, and the ONE place its labels are written.
 *
 * Two surfaces render the same four words and they must not drift: the
 * home grid's `SegmentedControl` (with counts) and each card's visibility
 * label. `KB_SCOPE_LABEL` in `../../scope.ts` now says the same word for
 * the same level ("Public"), so the card and the pill that filters to it
 * read alike; the two constants stay separate because only this row owns
 * the "All" pill and the counts.
 */
export const SCOPE_FILTERS: ReadonlyArray<{ key: ListFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "private", label: "Private" },
  { key: "team", label: "Team" },
  { key: "workspace", label: "Public" },
];

/** The visibility word one base's card carries, top-right. */
export const KB_SCOPE_CARD_LABEL: Record<KbScope, string> = {
  private: "Private",
  team: "Team",
  workspace: "Public",
};

/**
 * How many of `bases` each pill would show, keyed by filter — the
 * `SegmentedOption.count` badges.
 *
 * Feed this the SEARCH-filtered list and NOT the scope-filtered one: a
 * count under an unselected pill only means anything if it answers "how
 * many would I get if I clicked here", and scope-filtering first collapses
 * every other pill to zero.
 */
export function scopeCounts(bases: KnowledgeBase[]): Record<ListFilter, number> {
  const counts: Record<ListFilter, number> = {
    all: bases.length,
    private: 0,
    team: 0,
    workspace: 0,
  };
  for (const base of bases) counts[kbScope(base)] += 1;
  return counts;
}
