"use client";

import { ArrowRight, Bookmark } from "lucide-react";
import {
  OPEN_SCALE_ICON,
  OpenScaleButton,
} from "@/shared/ui/open-scale-button";
import { cn } from "@/shared/lib/utils";
import { kbScope, type KbScope } from "../../../scope";
import type { KnowledgeBase, KnowledgeBaseStats } from "../../../types";
import { kbCardLabel } from "../list-filters";
import { StorageMeter } from "../storage-meter";
import { shortWhen } from "../utils";
import styles from "../knowledge-v2.module.css";

interface Props {
  base: KnowledgeBase;
  /** Counters from the list response. `undefined` = route degraded or base is
   *  locally-seeded; meta line drops the count rather than claiming zero. */
  stats?: KnowledgeBaseStats;
  /** `null`/absent = unknown → no bar drawn. */
  storageLimit?: number | null;
  ownerLabel: string;
  /** Caller's own star — per-user, not a property of the base row. */
  starred: boolean;
  /**
   * Is this base granted into at least one channel? From the list response's
   * `sharedBaseIds` key — a fact about grants, never a column on the base row.
   * Drives the pill's word through `kbCardLabel`. Optional, so a stale-cache
   * read with no `sharedBaseIds` renders the scope word as it did before.
   */
  shared?: boolean;
  onOpen: (base: KnowledgeBase) => void;
  onToggleStar: (baseId: string, starred: boolean) => void;
}

/**
 * One knowledge base on the home grid.
 *
 * Container is an `<article>`, not a `<button>` — the bookmark and Open must be
 * sibling controls; `<button>` inside `<button>` is invalid HTML and browsers
 * reparent the inner one out of the card. Contracts that must hold:
 *
 *   - ONE keyboard Open action. Tab order: bookmark, then Open.
 *   - Container `onClick` is a mouse duplicate of Open; both real buttons stop
 *     propagation so one click fires exactly one thing.
 *   - `aria-label` names every control by its base.
 *   - `aria-pressed` on the bookmark: state in the a11y tree, not only the fill.
 */
/** Binds `--kv-scope` (see `.card` in the module) to this base's hue. Applied
 *  to the CONTAINER, not the pill: the accent sliver reads the same variable. */
const SCOPE_CLASS: Record<KbScope, string> = {
  private: styles.scopePrivate,
  team: styles.scopeTeam,
  workspace: styles.scopePublic,
};

export function BaseCard({
  base,
  stats,
  storageLimit,
  ownerLabel,
  starred,
  shared = false,
  onOpen,
  onToggleStar,
}: Props) {
  const description = base.description?.trim();
  const scope = kbScope(base);
  return (
    <article
      className={cn(styles.card, SCOPE_CLASS[scope])}
      aria-label={base.name}
      /* ⚠ The card's hand cursor, and the ONLY thing that carries it — read by the base
         layer's one clickable-cursor rule (`globals.css › ANYTHING CLICKABLE SHOWS THE
         HAND`). NOT a `role="button"`: the card already holds the star toggle, and a button
         inside a button is invalid. */
      data-clickable=""
      onClick={() => onOpen(base)}
    >
      <div className={styles.cardHead}>
        <span className={styles.cardName}>{base.name}</span>
        {/* the hue stays the scope's; only the WORD changes when a private
            base is shared — a fourth colour would read as a fourth visibility
            level. */}
        <span className={styles.cardScope}>{kbCardLabel(scope, shared)}</span>
      </div>

      {/* inset well: description, meta (+ meter) and footer are hairline-fenced
          rows inside it. */}
      <div className={styles.cardInset}>
        <div className={styles.cardDescRow}>
          <span className={styles.cardAccent} aria-hidden="true" />
          <span
            className={cn(
              styles.cardDesc,
              !description && styles.cardDescEmpty
            )}
          >
            {description || "No description"}
          </span>
        </div>

        <div className={styles.cardMetaRow}>
          <span className={styles.cardMeta}>
            {stats ? `${stats.entryCount} ${stats.entryCount === 1 ? "entry" : "entries"} · ` : ""}
            {`updated ${shortWhen(stats?.lastEntryUpdatedAt ?? base.updatedAt)} · By ${ownerLabel}`}
          </span>
          {/* absent stats or unresolved cap render nothing: missing is
              unknown, never zero. */}
          <StorageMeter
            usedBytes={stats?.storageBytes ?? null}
            limitBytes={storageLimit ?? null}
            className="mt-1.5"
          />
        </div>

        <div className={styles.cardFoot}>
          {/* icon and copy are Bookmark, matching channels; the DATA verb
              stays "star" (`onToggleStar`, `/knowledge/bases/[baseId]/star`). */}
          <button
            type="button"
            className={cn(styles.cardStar, starred && styles.cardStarOn)}
            aria-pressed={starred}
            aria-label={
              starred
                ? `Remove bookmark from ${base.name}`
                : `Bookmark ${base.name}`
            }
            onClick={(e) => {
              // else the card's onClick opens the base under the toggle.
              e.stopPropagation();
              onToggleStar(base.id, !starred);
            }}
          >
            <Bookmark
              size={14}
              // fill is the state; the outline is always drawn so the size
              // does not change between states.
              fill={starred ? "currentColor" : "none"}
              aria-hidden="true"
            />
          </button>

          {/* the face is shared, not local: this card must render the same
              component /home's section buttons do
              (`shared/ui/open-scale-button.module.css`). */}
          <OpenScaleButton
            aria-label={`Open ${base.name}`}
            onClick={(e) => {
              // else the container's handler fires too: `onOpen` twice.
              e.stopPropagation();
              onOpen(base);
            }}
          >
            Open
            <ArrowRight size={OPEN_SCALE_ICON} />
          </OpenScaleButton>
        </div>
      </div>
    </article>
  );
}
