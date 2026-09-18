import { kbScope, type KbScope } from "../../scope";
import type { KnowledgeBase } from "../../types";
import type { ListFilter } from "./types";

/**
 * Scope filter row, and the ONE place its labels are written.
 *
 * Must not drift from `KB_SCOPE_CARD_LABEL` below or `KB_SCOPE_LABEL` in
 * ../../scope.ts — all three name the same levels. Separate only because this
 * row owns the "All" pill and the counts.
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

/** The word a base shared into a channel carries instead of "Private"
 *  (2026-09-01, Samuel). Matches /home's "Shared in this channel" section. */
export const KB_SHARED_CARD_LABEL = "Shared";

/**
 * The pill's word for one base. A channel share overrides `private` and only
 * `private`: the ladder is `private` < shared-into-a-channel < `team` <
 * `workspace`, so `team`/`workspace` stay as they are — swapping them to
 * "Shared" would under-state exposure.
 *
 * Either grant level counts: the pill answers "is this still only mine", not
 * "who can read it".
 */
export function kbCardLabel(scope: KbScope, shared: boolean): string {
  if (shared && scope === "private") return KB_SHARED_CARD_LABEL;
  return KB_SCOPE_CARD_LABEL[scope];
}

/**
 * `SegmentedOption.count` badges per filter.
 *
 * Feed this the SEARCH-filtered list, not the scope-filtered one: an unselected
 * pill's count must answer "how many if I clicked here", and scope-filtering
 * first collapses every other pill to zero.
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
