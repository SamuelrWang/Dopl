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
  /** After search AND the scope pill — exactly what the grid renders. */
  bases: KnowledgeBase[];
  /** Per-pill badge counts, cut BEFORE the scope pill (see list-filters). */
  filterCounts: Record<ListFilter, number>;
  baseStats?: Record<string, KnowledgeBaseStats>;
  /** Per-base storage cap in bytes, from the same list response. `null` =
   *  unknown → no bars. */
  kbStorageLimit?: number | null;
  ownerNames?: Record<string, string>;
  /** CALLER'S OWN starred base ids. Lifted to the front of the grid; ⚠ never
   *  counted by the scope pills. */
  starredBaseIds?: string[];
  currentUserId: string;
  query: string;
  onQueryChange: (q: string) => void;
  filter: ListFilter;
  onFilterChange: (f: ListFilter) => void;
  onOpenBase: (base: KnowledgeBase) => void;
  /** Optimistic upstream, so the reorder below rides the click. */
  onToggleStar: (baseId: string, starred: boolean) => void;
  onCreate: () => void;
  /** Hero banner image, injected by the host app — the asset is Vite-bundled
   *  in the SPA and the shared tree cannot import it. Absent = no banner
   *  (the web + test default). */
  heroImageSrc?: string;
}

/**
 * KNOWLEDGE HOME — `/knowledge` mode of the component serving both knowledge
 * routes (`knowledge-v2.tsx` picks by selection).
 *
 * ⚠ MOUNTS NO TREES. A grid of N bases must cost ONE request, so nothing here
 * touches `trees`/`loadTree`; counts and timestamps ride the base list
 * (`GET /api/knowledge/bases › baseStats`). Opening a card loads a tree.
 *
 * ⚠ Star sort runs HERE — after search and the scope pill, over exactly the
 * cards about to render. That is what keeps stars a VIEW concern: a star moves
 * a card, never adds or removes one, and the pill badges (cut upstream of the
 * scope filter) never see it.
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
    // ⚠ ONE comparator, TWO groups, nothing else: sort is stable (ES2019), so
    // cards keep the filter's order WITHIN a group. Comparing on name/date
    // replaces the list's ordering with one only stars can see.
    // `[...bases]` because sort mutates and `bases` is the caller's array.
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

      {/* Decorative banner, so the image is alt="".
          ⚠ CHAT IS PART OF THE HERO, not a sibling — one rounded container,
          image band on top, gray panel below. Hence inside this guard: no
          bundled image means no hero AND no floating chat box. */}
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

          {/* ⚠ Always last, NEVER filtered away — a query matching nothing
              must not hide the only create affordance. */}
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

/** "You" for own/ownerless bases, resolved display name for another member's,
 *  neutral stand-in when the name lookup degraded. */
function ownerLabelFor(
  base: KnowledgeBase,
  currentUserId: string,
  ownerNames?: Record<string, string>
): string {
  if (base.createdBy === null || base.createdBy === currentUserId) return "You";
  return ownerNames?.[base.createdBy] ?? "Another member";
}
