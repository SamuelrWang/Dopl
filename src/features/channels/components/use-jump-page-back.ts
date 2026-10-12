"use client";

/**
 * **A JUMP THAT LANDS OFF THE LOADED PAGE PAGES BACK UNTIL IT CAN LAND**
 * (Samuel, 2026-10-12) — the half the citation pill was missing.
 *
 * Before this, a jump to a message older than the loaded transcript stopped at a
 * sentence: `message-pane.tsx › SCROLL_TARGET_MISSING_NOTE`, "older than the
 * loaded history, so the transcript did not move." That notice was a real
 * improvement on the silent no-op it replaced (`use-message-jump.ts:25-33`), but
 * it is still a dead end — the reader is told where the message isn't.
 *
 * ⚠ **THIS IS A DRIVER, NOT A SECOND MECHANISM, AND THAT IS THE WHOLE POINT.**
 * It mints no scroll target, scrolls nothing and highlights nothing. It only
 * decides WHETHER TO ASK FOR ANOTHER OLDER PAGE, and reports that it is still
 * asking. The landing stays exactly where it was — `message-pane.tsx`'s effect,
 * its `flashId`, its nonce. One resolver (`citationScrollTargetId`), one landing,
 * one flash; `@notification-deep-link` reuses the same seam.
 *
 * ⚠ **IT SERVES ALL THREE ENTRY POINTS BECAUSE IT HUNTS AN ID, NOT A SEQ.**
 *
 *   • a `#N` pill click → `citationScrollTargetId` could not resolve it, so the
 *     target is the `seq:<n>` SENTINEL. {@link scrollTargetSeq} reads the seq back
 *     out and the hunt re-resolves it to a real id once a page brings the row in.
 *   • a Mentions row in the info tab → the target is a REAL message id that is
 *     simply not on the page. There is no seq to read, and none is needed.
 *   • a notification's `initialSeq` → arrives through `use-message-jump.ts` and is
 *     therefore the first case.
 *
 * A hunt for a real id needs no seq at all, which is why the predicate below is
 * "is this id among the rows" rather than anything arithmetic. ⚠ **AND IT MUST
 * STAY THAT WAY**: `seq` is table-wide and gappy (INVARIANTS §5), so no sum over
 * the rows on hand can tell you how far back a target is. The only honest
 * algorithm is to ask for pages until the row appears or the bounds stop you.
 *
 * ⚠ **TWO BOUNDS, AND THEY ANSWER DIFFERENT FAILURES.**
 *   • {@link JUMP_PAGE_BACK_MAX_PAGES} is the WORK ceiling. `hasOlder` is answered
 *     by the server, so a long channel would otherwise page to its beginning on
 *     one click.
 *   • {@link JUMP_PAGE_BACK_DEADLINE_MS} is the STUCK backstop, for the case the
 *     page cap cannot see: a fetch that never settles leaves `loadingOlder` true
 *     forever, so no later attempt is ever made and no cap is ever reached.
 * Either bound ends the hunt in the honest notice — the same sentence as today,
 * reached after trying rather than instead of trying.
 *
 * ⚠ **NO SETSTATE IN AN EFFECT BODY** (`react-hooks/set-state-in-effect` is an
 * error in this tree). The abandon flag is set from a microtask or a timer — the
 * same async boundary `message-pane.tsx` already spends its nonce on — and the
 * page counter is a ref, like `use-load-older.ts`'s anchor and for its reason.
 */

import { useEffect, useRef, useState } from "react";

import { JUMP_PAGE_BACK_MAX_PAGES } from "../constants";
import { scrollTargetSeq } from "../lib/message-refs";

/**
 * How long one hunt may run before it gives up, whatever the page count says.
 *
 * ⚠ **THIS IS THE BACKSTOP, NOT THE BOUND.** The page cap ends an ordinary hunt
 * promptly; this only fires when `loadingOlder` never comes back down, which the
 * cap cannot detect because a stuck fetch makes no attempts. Generous on purpose:
 * twenty sequential reads on a slow connection is a legitimate deep hunt, and
 * abandoning one that is still making progress would be the worse failure.
 */
export const JUMP_PAGE_BACK_DEADLINE_MS = 15_000;

export interface JumpPageBack {
  /**
   * The message id to land on — the target re-resolved against the rows on hand.
   *
   * ⚠ **FOR A SENTINEL TARGET THIS IS THE REAL ID ONCE THE ROW ARRIVES**, which is
   * what makes paging back actually land. `citationScrollTargetId` resolved the
   * seq at CLICK time and minted `seq:<n>` because the row was absent; the scroll
   * target still holds that string afterwards, so without re-resolving here a
   * paged-in row would never be matched and the hunt would succeed invisibly.
   *
   * ⚠ Falls back to the target's own id, so a caller that drops this and uses
   * `scrollTarget.messageId` is merely back to today's behaviour, never broken.
   */
  targetId: string | null;
  /** The target is on the page now. The pane may land. */
  found: boolean;
  /**
   * Still paging back. ⚠ **THE PANE MUST SUPPRESS BOTH THE NOTICE AND THE LANDING
   * EFFECT WHILE THIS IS TRUE** — see the note in `message-pane.tsx`. Mid-hunt is
   * neither a hit nor a miss, and spending the nonce on it would kill the hunt
   * after its first page.
   */
  hunting: boolean;
}

export function useJumpPageBack({
  scrollTarget,
  rows,
  hasOlder,
  loadingOlder,
  onLoadOlder,
  maxPages = JUMP_PAGE_BACK_MAX_PAGES,
  deadlineMs = JUMP_PAGE_BACK_DEADLINE_MS,
}: {
  scrollTarget: { messageId: string; nonce: number } | null;
  /** This view's loaded rows — channel or thread, whichever the pane is showing. */
  rows: ReadonlyArray<{ id: string; seq: number }>;
  /** More history exists. ⚠ Server-answered; never re-derived from `rows.length`. */
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  maxPages?: number;
  deadlineMs?: number;
}): JumpPageBack {
  /** The nonce we have given up on, so a LATER click is never pre-abandoned. */
  const [abandonedNonce, setAbandonedNonce] = useState<number | null>(null);

  const quarrySeq =
    scrollTarget === null ? null : scrollTargetSeq(scrollTarget.messageId);
  // A sentinel resolves by seq; a real id resolves as itself.
  const bySeq =
    quarrySeq === null
      ? null
      : (rows.find((row) => row.seq === quarrySeq)?.id ?? null);
  const targetId =
    scrollTarget === null ? null : (bySeq ?? scrollTarget.messageId);
  const found = targetId !== null && rows.some((row) => row.id === targetId);

  const abandoned =
    scrollTarget !== null && abandonedNonce === scrollTarget.nonce;
  const hunting =
    scrollTarget !== null && !found && hasOlder && !abandoned;

  // ⚠ Per-nonce, so a newer click restarts the budget instead of inheriting a
  // spent one. A ref, not state: nothing renders from the count.
  const walked = useRef<{ nonce: number; pages: number }>({
    nonce: -1,
    pages: 0,
  });

  useEffect(() => {
    if (!hunting || loadingOlder || scrollTarget === null) return;
    const budget = walked.current;
    if (budget.nonce !== scrollTarget.nonce) {
      budget.nonce = scrollTarget.nonce;
      budget.pages = 0;
    }
    if (budget.pages >= maxPages) {
      // ⚠ **MICROTASK, NOT THE EFFECT BODY.** The cap has to become visible or
      // `hunting` stays true forever and the reader gets neither a landing nor a
      // notice — a hang dressed as patience.
      const spent = scrollTarget.nonce;
      queueMicrotask(() => setAbandonedNonce(spent));
      return;
    }
    budget.pages += 1;
    onLoadOlder();
  }, [hunting, loadingOlder, scrollTarget, onLoadOlder, maxPages]);

  useEffect(() => {
    if (!hunting || scrollTarget === null) return;
    const spent = scrollTarget.nonce;
    const timer = setTimeout(() => setAbandonedNonce(spent), deadlineMs);
    return () => clearTimeout(timer);
    // ⚠ `loadingOlder` IS DELIBERATELY NOT A DEPENDENCY. It flips twice per page,
    // and re-arming on it would restart the deadline on every page — a backstop
    // that can never fire is not a backstop.
  }, [hunting, scrollTarget, deadlineMs]);

  return { targetId, found, hunting };
}
