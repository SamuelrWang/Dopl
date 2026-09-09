"use client";

/**
 * STICK TO BOTTOM — the transcript scroller's reading-position rules, split out
 * of `message-pane.tsx` on 2026-08-20 at the 500-line cap.
 *
 * ⚠ THE SPLIT DOES NOT WEAKEN `message-pane.tsx`'s "ONE IMPLEMENTATION" ARGUMENT:
 * a hook exactly one pane calls is still one copy — what would break it is a
 * SECOND pane, not a second file. Both surfaces that render a channel (channels-v2
 * on the web and in the desktop workspace pages, and the desktop Home pane, which
 * mounts this same tree) get this file's answer.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type RefObject,
} from "react";

/**
 * How close to the bottom still counts as being AT the bottom. A reader who drifted
 * a line is still following; one who scrolled up to read history is not, and
 * yanking them down is the classic chat bug.
 */
const STICK_SLACK_PX = 64;

/**
 * How long a SMOOTH follow owns the scroller. While it is in flight rule 3 stands
 * down: a re-pin mid-animation lands the reader at the bottom of the message the
 * animation was aligning the TOP of — rule 2 undone a frame later.
 * ⚠ A TIMER AND NOT A `scrollend` LISTENER: that event is not in jsdom nor in
 * every shipped WebKit this app runs inside, and a watcher that never re-arms is
 * a pin that silently stops working.
 */
const FOLLOW_ANIMATION_MS = 700;

/**
 * STICK TO BOTTOM — a transcript that renders oldest-first and never scrolls opens
 * on the oldest message in the channel, the wrong end of every chat surface.
 *
 * ⚠ **REWRITTEN 2026-09-08 AGAINST SAMUEL'S REPORT**: "when i open a channel, I do not start
 * at the most recent message, It keeps on starting in the middle somewhere, and then I have to
 * scroll down to the most recent message." The three rules below are what that report bought.
 *
 *  1. **LANDING IS THE BOTTOM, NOT THE START OF THE LAST ROW.** While the transcript on screen
 *     does not yet belong to this `viewKey` — the read is in flight, or `keepPreviousData` is
 *     still showing the PREVIOUS channel's rows (`use-channel-messages.ts › stale`) — every row
 *     change pins HARD to `scrollHeight`, in a LAYOUT effect. ⚠ THIS IS THE BUG SAMUEL SAW:
 *     opening a channel changes the row count TWICE (placeholder rows, then the real
 *     transcript) and the old `landed` flag was spent on the FIRST, so the second took rule 2's
 *     branch and animated to the START of a long post — "the middle somewhere".
 *  2. **ONLY A GENUINELY NEW LAST MESSAGE ALIGNS TO ITS START** — a changed `lastRowId`, never
 *     a bare `rowCount` change. ⚠ AN OLDER PAGE LOAD GROWS `rowCount` AND CHANGES NO
 *     `lastRowId`, and must do nothing here: `use-load-older.ts` owns that commit and restores
 *     its anchor, and a follow beside it would throw the reader out of the history they
 *     scrolled up to read.
 *  3. **GROWTH KEEPS THE PIN.** A `ResizeObserver` on the scroller's content re-pins a pinned
 *     reader whenever `scrollHeight` grows with NO row change — an agent streaming into a row
 *     on screen, an image or code block laying out after first paint.
 *
 * ⚠ A READER SCROLLED UP IS NEVER YANKED, and that outranks all three: the old page followed
 * unconditionally, so a message arriving mid-scrollback threw the reader to the end.
 *
 * ⚠ REFS, NOT STATE: `react-hooks/set-state-in-effect` is an ERROR in this tree,
 * and a pin held in state would re-render the whole transcript on every scroll
 * event to decide something nothing renders.
 *
 * ⚠ THE PIN IS MEASURED ON THE USER'S OWN SCROLL AND NOWHERE ELSE — a row that
 * GROWS after paint must not un-pin a reader sitting at the bottom; only a scroll
 * says "I moved away". Rule 3 depends on it: the observer re-pins on `pinned`
 * alone, so a measurement taken anywhere else would make growth un-pin the reader
 * it is meant to follow.
 *
 * Returns `release`, which the mention jump calls: a deliberate landing in
 * history is a reading position the next arriving message must not undo.
 */
export function useStickToBottom(
  scrollerRef: RefObject<HTMLDivElement | null>,
  /** Channel + thread — the identity of the VIEW, so a switch is one change. */
  viewKey: string,
  rowCount: number,
  /**
   * THE NEWEST ROW'S id — what rule 2 SMOOTH-SCROLLS TO the START of (Samuel, 2026-09-04),
   * and since 2026-09-08 the ONLY thing that triggers rule 2 at all.
   *
   * ⚠ OPTIONAL, AND ABSENT IS THE OLD ROW-COUNT BEHAVIOUR: a jump to `scrollHeight` whenever
   * the count grows. Callers that know nothing about row ids (tests on a fixed list, the
   * marketing banner's scripted scene) are unchanged — and cannot tell an appended message
   * from a prepended page, so they get no older-page exemption either.
   * ⚠ IT IS MATCHED AGAINST `data-message-id`, the attribute the mention jump queries — one
   * attribute, two readers, so a row kind that stopped rendering it breaks both visibly.
   */
  lastRowId: string | null = null,
  /**
   * IS THE TRANSCRIPT ON SCREEN STILL SETTLING ONTO `viewKey` — rule 1's gate.
   *
   * ⚠ `loading || stale`, and the `stale` half is the one that matters: on a switch
   * `keepPreviousData` keeps the PREVIOUS channel's rows on screen with `isPending` FALSE, so
   * `loading` alone never sees the swap. `use-channel-messages.ts › stale` is that window.
   */
  settling = false
) {
  const pinned = useRef(true);
  /**
   * HAS THIS VIEW HAD ITS SETTLED LANDING — set by the first row commit that is NOT
   * settling, so a channel open spends it on the real transcript rather than the
   * placeholder before it.
   */
  const landed = useRef(false);
  /** The `lastRowId` this hook has already reacted to — rule 2's "genuinely new" test. */
  const seenLastRowId = useRef<string | null>(lastRowId);
  /** The `rowCount` already reacted to — the fallback test when no ids are passed. */
  const seenRowCount = useRef(rowCount);
  /** A smooth follow is in flight; rule 3 stands down until it clears. */
  const following = useRef(false);
  const followTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      pinned.current =
        el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_SLACK_PX;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [scrollerRef]);

  // Rule 1's first half — the VIEW SWITCH itself. Re-arms the pin as well as
  // moving: the previous view's reading position says nothing about this one.
  // ⚠ LAYOUT, so the old view's offset is never painted under the new view's rows.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    pinned.current = true;
    // ⚠ AND THE VIEW HAS NOT LANDED YET, so rule 1 owns this view until its real
    // transcript has arrived and settled.
    landed.current = false;
    following.current = false;
    el.scrollTop = el.scrollHeight;
  }, [scrollerRef, viewKey]);

  // Rules 1 and 2. ⚠ DECLARED BEFORE THE SCROLL-TARGET EFFECT IN `message-pane.tsx`, which is
  // load-bearing: this is a LAYOUT effect and that one is passive, so on a commit where a
  // mention click both swaps the view and asks for a jump, the jump runs LAST and wins.
  // `use-load-older.ts`'s anchor restore sits between them: stick → anchor → jump.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    const previousId = seenLastRowId.current;
    const previousCount = seenRowCount.current;
    seenLastRowId.current = lastRowId;
    seenRowCount.current = rowCount;
    if (!el || !pinned.current) return;
    /**
     * RULE 1 — still settling, or this view has not had its settled landing yet: hard to the
     * bottom, instantly, and `landed` is NOT spent on a placeholder commit.
     */
    if (settling || !landed.current) {
      landed.current = !settling;
      el.scrollTop = el.scrollHeight;
      return;
    }
    /**
     * RULE 2 — a genuinely NEW last message, and nothing else. With ids, that is a changed
     * `lastRowId`; without them, a grown `rowCount` (see the parameter's note).
     */
    const appended = lastRowId
      ? lastRowId !== previousId
      : rowCount > previousCount;
    if (!appended) return;
    /**
     * ⚠ THE TARGET IS THE NEW MESSAGE'S START, NOT THE END OF THE TRANSCRIPT (Samuel, 2026-09-04).
     * For a message TALLER than the pane, jumping to `scrollHeight` lands the reader on its last
     * line — past the sender pill, mid-sentence; aligning its top edge to the pane's makes it read
     * from the beginning.
     * ⚠ CLAMPED TO THE SCROLLER'S OWN MAXIMUM, which is what makes the short case fall out for
     * free rather than needing a height test.
     * ⚠ MEASURED WITH RECTS, NOT `offsetTop`, which is relative to the nearest POSITIONED ancestor
     * and silently wrong the moment a row wrapper gains `relative`.
     */
    const row = lastRowId
      ? el.querySelector(`[data-message-id="${lastRowId}"]`)
      : null;
    if (!row) {
      el.scrollTop = el.scrollHeight;
      return;
    }
    // ⚠ THE READER'S OWN SETTING WINS, the same rule the mention jump follows.
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const desired =
      el.scrollTop + (row.getBoundingClientRect().top - el.getBoundingClientRect().top);
    const top = Math.min(desired, el.scrollHeight - el.clientHeight);
    // ⚠ `scrollTo` IS NOT ASSUMED TO EXIST (2026-09-05). It is the one call here that is not a
    // plain `scrollTop` assignment, and an environment without it threw out of an effect —
    // React escalated that to the nearest error boundary and the whole message pane rendered
    // as an error page rather than as a missing animation.
    if (typeof el.scrollTo === "function") {
      el.scrollTo({ top, behavior: reduceMotion ? "auto" : "smooth" });
    } else {
      el.scrollTop = top;
    }
    // Only a real ANIMATION locks rule 3 out; a reduced-motion jump has already landed.
    if (reduceMotion) return;
    following.current = true;
    if (followTimer.current !== null) clearTimeout(followTimer.current);
    followTimer.current = setTimeout(() => {
      following.current = false;
      followTimer.current = null;
    }, FOLLOW_ANIMATION_MS);
  }, [scrollerRef, rowCount, lastRowId, settling]);

  // Rule 3 — GROWTH KEEPS THE PIN; no effect above can see it, the deps not having
  // changed.
  // ⚠ THE SCROLLER'S CHILDREN, not the scroller: a `ResizeObserver` on the box
  // reports the BORDER box, which does not move when content grows inside an
  // `overflow-y-auto`. The children are re-observed whenever the pane swaps them.
  // ⚠ `typeof` GUARD: jsdom has no `ResizeObserver`, and an unguarded `new` throws
  // out of an effect and unmounts the pane into an error boundary.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (!pinned.current || following.current) return;
      el.scrollTop = el.scrollHeight;
    });
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [scrollerRef, viewKey, rowCount, settling]);

  // A pending follow timer must not outlive the pane (or the view), or rule 3
  // stays locked out on the next mount.
  useEffect(
    () => () => {
      if (followTimer.current !== null) clearTimeout(followTimer.current);
      followTimer.current = null;
      following.current = false;
    },
    [viewKey]
  );

  return useCallback(() => {
    pinned.current = false;
  }, []);
}
