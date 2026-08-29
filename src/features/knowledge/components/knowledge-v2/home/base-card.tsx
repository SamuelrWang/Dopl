"use client";

import { ArrowRight, Bookmark } from "lucide-react";
import {
  OPEN_SCALE_ICON,
  OpenScaleButton,
} from "@/shared/ui/open-scale-button";
import { cn } from "@/shared/lib/utils";
import { kbScope, type KbScope } from "../../../scope";
import type { KnowledgeBase, KnowledgeBaseStats } from "../../../types";
import { KB_SCOPE_CARD_LABEL } from "../list-filters";
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
  /** ⚠ CALLER'S OWN star — per-user, not a property of the base row. */
  starred: boolean;
  onOpen: (base: KnowledgeBase) => void;
  onToggleStar: (baseId: string, starred: boolean) => void;
}

/**
 * One knowledge base on the home grid.
 *
 * ⚠ Container is an `<article>`, NOT a `<button>` — the bookmark and Open must
 * be sibling controls; `<button>` inside `<button>` is invalid HTML and browsers
 * reparent the inner one out of the card. Contracts that must hold:
 *
 *   - ONE keyboard Open action (the Open button). Tab order: bookmark, then
 *     Open.
 *   - Container `onClick` is a MOUSE duplicate of Open; both real buttons stop
 *     propagation so one click fires exactly one thing.
 *   - `aria-label` names every control by its base — otherwise the grid is N
 *     buttons all called "Open".
 *   - `aria-pressed` on the bookmark: it's a toggle, state must be in the a11y
 *     tree, not only the fill colour.
 */
/** Binds `--kv-scope` (see `.card` in the module) to this base's hue. ⚠ Applied
 *  to the CONTAINER, not the pill: the accent sliver reads the same variable,
 *  and colouring the pill directly is how the two drift apart. */
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
  onOpen,
  onToggleStar,
}: Props) {
  const description = base.description?.trim();
  const scope = kbScope(base);
  return (
    <article
      className={cn(styles.card, SCOPE_CLASS[scope])}
      aria-label={base.name}
      onClick={() => onOpen(base)}
    >
      <div className={styles.cardHead}>
        <span className={styles.cardName}>{base.name}</span>
        <span className={styles.cardScope}>{KB_SCOPE_CARD_LABEL[scope]}</span>
      </div>

      {/* Inset well: description, meta (+ meter) and footer are hairline-fenced
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
          {/* Absent stats or unresolved cap render nothing: missing is
              unknown, never zero. */}
          <StorageMeter
            usedBytes={stats?.storageBytes ?? null}
            limitBytes={storageLimit ?? null}
            className="mt-1.5"
          />
        </div>

        <div className={styles.cardFoot}>
          {/* ⚠ Icon and COPY are Bookmark — one save affordance across the app,
              matching channels (`channels-v2/message-pane.tsx`, lucide
              `Bookmark` at size 14). The DATA verb stays "star"
              (`onToggleStar`, `/knowledge/bases/[baseId]/star`): that is the
              route/service vocabulary and it did not change with the icon. */}
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
              // ⚠ Else the card's onClick opens the base under the toggle.
              e.stopPropagation();
              onToggleStar(base.id, !starred);
            }}
          >
            <Bookmark
              size={14}
              // Fill is the state — a filled bookmark reads as saved; outline
              // always drawn so the size does not change between states.
              fill={starred ? "currentColor" : "none"}
              aria-hidden="true"
            />
          </button>

          {/* ⚠ THE FACE IS SHARED, NOT LOCAL (2026-08-28). It used to be
              `cn("btn-light", styles.cardOpen)` here; those declarations moved
              to `shared/ui/open-scale-button.module.css` when /home's section
              buttons adopted this button's size — this card must render the
              same component they do, or "adopted" lasts until the next edit. */}
          <OpenScaleButton
            aria-label={`Open ${base.name}`}
            onClick={(e) => {
              // ⚠ Else the container's handler fires too: `onOpen` twice.
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
