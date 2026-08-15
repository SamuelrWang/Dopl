"use client";

import { ArrowRight, Star } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { kbScope, type KbScope } from "../../../scope";
import type { KnowledgeBase, KnowledgeBaseStats } from "../../../types";
import { KB_SCOPE_CARD_LABEL } from "../list-filters";
import { StorageMeter } from "../storage-meter";
import { shortWhen } from "../utils";
import styles from "../knowledge-v2.module.css";

interface Props {
  base: KnowledgeBase;
  /** Counters from the list response. `undefined` = the route degraded or
   *  the entry is a locally-seeded base the server hasn't answered for yet;
   *  the meta line drops the count rather than claiming zero. */
  stats?: KnowledgeBaseStats;
  /** The workspace's per-base storage cap in bytes; `null`/absent = unknown,
   *  and the card then draws no bar (same rule as the entry count). */
  storageLimit?: number | null;
  /** Who to credit: the owner's display name, or "You" for the caller's own. */
  ownerLabel: string;
  /** THE CALLER'S OWN star. Per-user — nothing about the base row says this. */
  starred: boolean;
  onOpen: (base: KnowledgeBase) => void;
  onToggleStar: (baseId: string, starred: boolean) => void;
}

/**
 * One knowledge base on the home grid: name + visibility, an inset panel
 * holding the description, a meta line, and a footer carrying the star and the
 * Open affordance.
 *
 * ── THE CARD IS NOT A BUTTON ANY MORE (2026-08-12), and it is worth knowing
 *    what that bought and what it cost.
 *
 * It used to be ONE `<button>` wrapping everything, with "Open →" as a styled
 * `<span>`: one target, one action, nothing nested. The star ends that. A
 * second control on the card cannot be a `<button>` inside a `<button>` —
 * invalid HTML, and browsers reparent it out of the card entirely, so it is
 * not merely unreachable by keyboard, it is somewhere else in the DOM.
 * Absolutely positioning a sibling button over the footer would keep the old
 * markup at the cost of a control whose position is a magic number and whose
 * reading order has nothing to do with where it appears.
 *
 * SO THE CONTAINER IS AN `<article>` and the two real controls are siblings in
 * the footer. What was preserved, deliberately:
 *
 *   - **ONE obvious Open action.** The "Open →" span was PROMOTED to the
 *     button; nothing else opens by keyboard. Tab order is star, then Open.
 *   - **Clicking the card still opens it.** The container keeps an `onClick`
 *     as a MOUSE convenience — it is not the accessible control, it duplicates
 *     the Open button rather than competing with it, and both real buttons
 *     stop propagation so a click on either fires exactly one thing.
 *   - **Every control is named by its base.** A grid of cards otherwise
 *     presents N buttons all called "Open", which a screen reader cannot tell
 *     apart. `aria-label` carries the base name on all three.
 *   - **`aria-pressed` on the star**, because it is a toggle: the state has to
 *     be in the accessibility tree, not only in the fill colour.
 *
 * The `<span>` soup that the old markup needed (a `<div>` or `<p>` inside a
 * `<button>` is invalid) is gone with it — these are `<div>`s again, and
 * `StorageMeter` renders in its normal block form rather than `inline`.
 */
/**
 * The card class that binds `--kv-scope` (see `.card` in the module) to this
 * base's hue. ONE lookup, applied to the CONTAINER rather than to the pill,
 * because the accent sliver two rows down reads the same variable — colouring
 * the pill directly is how the two would drift apart.
 */
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

      {/* The inset well runs from under the name to the card's bottom edge:
          description, meta (+ meter), and the footer are all rows inside it,
          separated by hairlines. */}
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
          {/* No `inline` any more: the card stopped being a `<button>`, so the
              meter's ancestors admit flow content and it can render its normal
              form. Absent stats or an unresolved cap render nothing at all —
              missing is unknown, never zero. */}
          <StorageMeter
            usedBytes={stats?.storageBytes ?? null}
            limitBytes={storageLimit ?? null}
            className="mt-1.5"
          />
        </div>

        <div className={styles.cardFoot}>
          <button
            type="button"
            className={cn(styles.cardStar, starred && styles.cardStarOn)}
            aria-pressed={starred}
            aria-label={
              starred ? `Unstar ${base.name}` : `Star ${base.name}`
            }
            onClick={(e) => {
              // The card's own onClick would otherwise open the base out from
              // under the toggle.
              e.stopPropagation();
              onToggleStar(base.id, !starred);
            }}
          >
            <Star
              size={14}
              // The fill is the state; the outline is always drawn so the
              // shape does not change size between the two.
              fill={starred ? "currentColor" : "none"}
              aria-hidden="true"
            />
          </button>

          <button
            type="button"
            className={cn("btn-light", styles.cardOpen)}
            aria-label={`Open ${base.name}`}
            onClick={(e) => {
              // Without this the container's handler fires too and `onOpen`
              // runs twice for one click.
              e.stopPropagation();
              onOpen(base);
            }}
          >
            Open
            <ArrowRight size={12} />
          </button>
        </div>
      </div>
    </article>
  );
}
