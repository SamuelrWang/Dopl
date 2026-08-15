"use client";

import { useMemo } from "react";
import { Plus } from "lucide-react";
import { LiquidGlass } from "@/shared/design/liquid-glass/liquid-glass";
import { SearchField } from "@/shared/ui/search-field";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import type { KnowledgeBase, KnowledgeBaseStats } from "../../../types";
import type { ListFilter } from "../types";
import { SCOPE_FILTERS } from "../list-filters";
import { BaseCard } from "./base-card";
import { HeroChat } from "./hero-chat";
import styles from "../knowledge-v2.module.css";

interface Props {
  /** Bases after search AND the scope pill — what the grid renders. */
  bases: KnowledgeBase[];
  /** Per-pill badge counts, cut BEFORE the scope pill (see list-filters). */
  filterCounts: Record<ListFilter, number>;
  /** `{entryCount, lastEntryUpdatedAt, storageBytes}` keyed by base id, from
   *  the list route. */
  baseStats?: Record<string, KnowledgeBaseStats>;
  /** The workspace's per-base storage cap in bytes — ONE number for every
   *  card, folded into the same list response. `null` = unknown, no bars. */
  kbStorageLimit?: number | null;
  /** Display names for foreign base owners, keyed by user id. */
  ownerNames?: Record<string, string>;
  /** The CALLER'S OWN starred base ids, from the same list response. Lifted to
   *  the front of the grid; never counted by the scope pills. */
  starredBaseIds?: string[];
  currentUserId: string;
  query: string;
  onQueryChange: (q: string) => void;
  filter: ListFilter;
  onFilterChange: (f: ListFilter) => void;
  onOpenBase: (base: KnowledgeBase) => void;
  /** Toggle the caller's star. Optimistic upstream, so the reorder below is
   *  driven by the click, not by the round trip. */
  onToggleStar: (baseId: string, starred: boolean) => void;
  onCreate: () => void;
  /** Bundled hero image for the banner above the filters. Injected by the
   *  host app (the asset is Vite-bundled in the SPA — the shared tree cannot
   *  import it); absent = no banner, which is also the test default. */
  heroImageSrc?: string;
}

/**
 * KNOWLEDGE HOME — the `/knowledge` mode of the one component that serves
 * both knowledge routes (`knowledge-v2.tsx` picks by selection). A card grid
 * over every visible base, with the search field and the scope pills that
 * narrow it; the trailing dashed cell creates a new base.
 *
 * MOUNTS NO TREES. A grid of N bases must cost ONE request, so nothing here
 * touches `trees`/`loadTree` — the entry counts and content timestamps come
 * folded into the base list itself (`GET /api/knowledge/bases › baseStats`).
 * Opening a card is what loads a tree.
 *
 * STARRED BASES SORT TO THE FRONT, and the sort runs HERE — after search and
 * the scope pill, over exactly the cards this grid is about to render. That
 * ordering is what makes stars a VIEW concern rather than a filter one: a star
 * changes where a card sits, never whether it is in the results, and the pill
 * badges (cut upstream, before the scope filter) never see it.
 */
export function KnowledgeHome({
  bases,
  filterCounts,
  baseStats,
  kbStorageLimit,
  ownerNames,
  starredBaseIds,
  currentUserId,
  query,
  onQueryChange,
  filter,
  onFilterChange,
  onOpenBase,
  onToggleStar,
  onCreate,
  heroImageSrc,
}: Props) {
  const starred = useMemo(
    () => new Set(starredBaseIds ?? []),
    [starredBaseIds]
  );
  const ordered = useMemo(() => {
    if (starred.size === 0) return bases;
    // ONE comparator, TWO groups, and nothing else — `Array.prototype.sort` is
    // stable (ES2019), so every card keeps the position the filter gave it
    // WITHIN its group. Comparing on anything more (name, date) would quietly
    // replace the list's own ordering with a second one that only stars can
    // see. `[...bases]` because sort mutates and `bases` is the caller's array.
    return [...bases].sort(
      (a, b) => Number(starred.has(b.id)) - Number(starred.has(a.id))
    );
  }, [bases, starred]);

  return (
    <div className={styles.home}>
      <div className={styles.homeHead}>
        <h1 className="text-display font-semibold tracking-tight text-text-primary">
          Knowledge
        </h1>
        <div className={styles.headSpacer} />
        <SearchField value={query} onChange={onQueryChange} className="w-64" />
      </div>

      {/* Hero banner — bundled image with the auth pages' liquid-glass panel
          over its left side (the same shared component as the login slab),
          and the assistant panel attached to its bottom edge. Decorative: the
          blurb is presentation, so the image is alt="".

          THE CHAT IS PART OF THE HERO, not a sibling of it — one rounded
          container, image band on top, gray panel below. So it is inside this
          guard rather than beside it: no bundled image means no hero, and a
          chat box floating alone above the pills would be a different
          component than the one that was designed. It also keeps the web/test
          default (no `heroImageSrc`) exactly as clean as it was. */}
      {heroImageSrc && (
        <div className={styles.homeHero}>
          <div className={styles.homeHeroBand}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={heroImageSrc} alt="" className={styles.homeHeroImg} />
            <LiquidGlass
              radius={18}
              className="absolute bottom-4 left-4 top-4 w-[360px] max-w-[46%]"
            >
              <div className="flex h-full flex-col justify-center px-6">
                <h2 className="text-title font-semibold text-white">
                  Your team&apos;s living library
                </h2>
                <p className="mt-1.5 text-caption font-light leading-[1.5] text-[#e3e3e3]">
                  Knowledge bases hold the docs, notes, and playbooks your
                  agents read and write — organized, shareable, and always
                  current.
                </p>
              </div>
            </LiquidGlass>
          </div>
          <HeroChat />
        </div>
      )}

      <SegmentedControl
        options={SCOPE_FILTERS.map((f) => ({
          ...f,
          count: filterCounts[f.key],
        }))}
        value={filter}
        onChange={onFilterChange}
        className={styles.homeFilters}
      />

      <div className={styles.homeBody}>
        <div className={styles.cardGrid}>
          {ordered.map((base) => (
            <BaseCard
              key={base.id}
              base={base}
              stats={baseStats?.[base.id]}
              storageLimit={kbStorageLimit}
              ownerLabel={ownerLabelFor(base, currentUserId, ownerNames)}
              starred={starred.has(base.id)}
              onOpen={onOpenBase}
              onToggleStar={onToggleStar}
            />
          ))}

          {/* Always last, never filtered away: creating a base is not a
              search result, and a grid that hides its only create affordance
              whenever the query matches nothing is a dead end. */}
          <button
            type="button"
            className={styles.cardNew}
            aria-label="New knowledge base"
            onClick={onCreate}
          >
            <span className={styles.cardNewPlus}>
              <Plus size={18} />
            </span>
            <span className={styles.cardNewLabel}>New knowledge base</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/** "You" for the caller's own bases (and ownerless seeds), the resolved
 *  display name for another member's, a neutral stand-in when the name
 *  lookup degraded. */
function ownerLabelFor(
  base: KnowledgeBase,
  currentUserId: string,
  ownerNames?: Record<string, string>
): string {
  if (base.createdBy === null || base.createdBy === currentUserId) return "You";
  return ownerNames?.[base.createdBy] ?? "Another member";
}
