import { kbScope, type KbScope } from "../../scope";
import type { KnowledgeBase } from "../../types";
import type { ListFilter } from "./types";

/**
 * Scope filter row, and the ONE place its labels are written.
 *
 * ⚠ Must not drift from `KB_SCOPE_CARD_LABEL` below or `KB_SCOPE_LABEL` in
 * ../../scope.ts — all three name the same levels. Kept separate only because
 * this row owns the "All" pill and the counts.
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
 * The word a base shared into a channel carries INSTEAD of "Private"
 * (2026-09-01, Samuel: a base shared into a channel was still reading
 * "Private").
 *
 * ⚠ **THE VOCABULARY IS ALREADY IN THE PRODUCT** — /home's Knowledge face heads
 * its first section "SHARED IN THIS CHANNEL" (`pages/home/knowledge-panels.tsx`)
 * — so this is that word, not a new one.
 */
export const KB_SHARED_CARD_LABEL = "Shared";

/**
 * The pill's word for one base.
 *
 * 🔒 **A CHANNEL SHARE OVERRIDES `private` AND ONLY `private`, AND THAT IS THE
 * WHOLE RULE.** The pill communicates how far a base reaches, and the ladder is
 * `private` < shared-into-a-channel < `team` < `workspace`. So:
 *   - `private` + shared → **Shared**. This is the bug: the base had left the
 *     operator's own shelf and the card still said it had not.
 *   - `team` / `workspace` + shared → unchanged. Both already reach FURTHER than
 *     one channel, and replacing "Public" with "Shared" would narrow what the
 *     card claims — under-stating exposure, which is the direction this fix
 *     exists to close, applied backwards.
 *   - not shared → the scope's own word, exactly as before.
 *
 * ⚠ THE SHARE IS EITHER LEVEL. `agent_only` and `visible` both mean the base has
 * left the private shelf; the pill answers "is this still only mine", not "who
 * can read it".
 */
export function kbCardLabel(scope: KbScope, shared: boolean): string {
  if (shared && scope === "private") return KB_SHARED_CARD_LABEL;
  return KB_SCOPE_CARD_LABEL[scope];
}

/**
 * `SegmentedOption.count` badges per filter.
 *
 * ⚠ Feed this the SEARCH-filtered list, NOT the scope-filtered one: an
 * unselected pill's count must answer "how many if I clicked here", and
 * scope-filtering first collapses every other pill to zero.
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
