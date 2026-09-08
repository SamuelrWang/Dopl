"use client";

/**
 * STICK TO BOTTOM — the transcript scroller's reading-position rules, split out
 * of `message-pane.tsx` on 2026-08-20 when the peer-activity slot took that file
 * past the 500-line cap.
 *
 * ⚠ THE SPLIT DOES NOT WEAKEN THE "ONE IMPLEMENTATION" ARGUMENT `message-pane.tsx`
 * makes, and that is why this seam and not another. Its docblock says the pop-out
 * mounts the same pane rather than assembling a second one out of `transcript.tsx`
 * + `composer.tsx`, precisely so these rules have ONE copy. A hook in a sibling
 * file that exactly one pane calls is still one copy — what would break the
 * argument is a SECOND pane, not a second file. Both surfaces that render a
 * channel (channels-v2 on the web AND in the desktop workspace pages, and the
 * desktop Home pane, which mounts this same tree) get this file's answer.
 *
 * ⚠ The slack constant lives here with the rule that reads it.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type RefObject,
} from "react";

/**
 * How close to the bottom still counts as being AT the bottom. A reader who has
 * drifted a line is still following the conversation; one who has scrolled up
 * to read history is not, and yanking them down is the classic chat bug.
 */
const STICK_SLACK_PX = 64;

/**
 * How long a SMOOTH follow owns the scroller. While it is in flight the growth
 * watcher below stands down: a re-pin fired mid-animation lands the reader at
 * the very bottom of the message the animation was aligning the TOP of, which is
 * exactly what rule 2 exists to prevent — undone by rule 3 a frame later.
 * ⚠ A TIMER AND NOT A `scrollend` LISTENER: that event is not in jsdom and was
 * not in every shipped WebKit this app runs inside, and a watcher that never
 * re-arms is a pin that silently stops working.
 */
const FOLLOW_ANIMATION_MS = 700;

/**
 * STICK TO BOTTOM — the behaviour the retired page had and this pane lost at
 * the cutover. A transcript that renders oldest-first and never scrolls opens
 * on the oldest message in the channel, which is the wrong end of every chat
 * surface ever built.
 *
 * ⚠ **REWRITTEN 2026-09-08 AGAINST SAMUEL'S REPORT**: "when i open a channel, I do not start
 * at the most recent message, It keeps on starting in the middle somewhere, and then I have to
 * scroll down to the most recent message." The three rules below are what that report bought;
 * each one names the way the previous shape got it wrong.
 *
 *  1. **LANDING IS THE BOTTOM, NOT THE START OF THE LAST ROW.** While the transcript on screen
 *     does not yet belong to this `viewKey` — the read is in flight, or `keepPreviousData` is
 *     still showing the PREVIOUS channel's rows (`use-channel-messages.ts › stale`) — every row
 *     change pins HARD to `scrollHeight`, in a LAYOUT effect so no frame is painted anywhere
 *     else. ⚠ THIS IS THE BUG SAMUEL SAW. Opening a channel changes the row count TWICE: once
 *     when the placeholder rows mount and once when the real transcript replaces them. The old
 *     `landed` flag was spent on the FIRST of those, so the second — the one that carries the
 *     actual conversation — took rule 2's branch and animated to the START of the newest
 *     message. For an agent's long post that start is a screen or more above the bottom, and
 *     the reader lands "in the middle somewhere".
 *  2. **ONLY A GENUINELY NEW LAST MESSAGE ALIGNS TO ITS START**, i.e. a change of `lastRowId`,
 *     never a bare `rowCount` change. ⚠ AN OLDER PAGE LOAD GROWS `rowCount` AND CHANGES NO
 *     `lastRowId`, and it must do nothing here: `use-load-older.ts` owns that commit, restores
 *     its anchor in its own layout effect, and a follow firing alongside it would throw the
 *     reader out of the history they scrolled up to read.
 *  3. **GROWTH KEEPS THE PIN.** A `ResizeObserver` on the scroller's content re-pins a pinned
 *     reader whenever `scrollHeight` grows with NO row change — an agent streaming into a row
 *     already on screen, an image or a code block laying out after first paint. Nothing else
 *     watched for this, so the pane simply stayed where it was, above the bottom.
 *
 * ⚠ A READER SCROLLED UP IS NEVER YANKED, and that outranks all three. The old page followed
 * unconditionally, so a message arriving mid-scrollback threw the reader back to the end of the
 * conversation. `STICK_SLACK_PX` is one subtraction and is strictly better.
 *
 * ⚠ REFS, NOT STATE, AND THAT IS NOT A MICRO-OPTIMISATION.
 * `react-hooks/set-state-in-effect` is an ERROR in this tree; a pin held in
 * state would also re-render the whole transcript on every scroll event, to
 * decide something nothing renders.
 *
 * ⚠ THE PIN IS MEASURED ON THE USER'S OWN SCROLL AND NOWHERE ELSE. A row that
 * GROWS after paint must not silently un-pin a reader sitting at the bottom;
 * only a scroll says "I moved away". This rule was INHERITED from the desktop's
 * v1 session stream, whose renderer (`renderer/session/**`) is deleted — the
 * behaviour is the thing that survived, not the file, so do not go looking for
 * its `bottomGap` to compare against. The near-bottom guard below IS the
 * statement of record now. Rule 3 depends on it: the observer re-pins on
 * `pinned` alone, so a measurement taken anywhere but a real scroll would make
 * growth un-pin the reader it is meant to follow.
 *
 * Returns `release`, which the mention jump calls: a deliberate landing in
 * history is a reading position, and the next arriving message must not undo
 * it.
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
   * the count grows. Every caller that knows nothing about row ids (the tests that mount the
   * pane on a fixed list, the marketing banner's scripted scene) is unchanged — and such a
   * caller cannot be told an appended message from a prepended page, so it does not get rule
   * 2's older-page exemption either. Every real transcript passes the id.
   * ⚠ IT IS MATCHED AGAINST `data-message-id`, the same hook the mention jump queries — one
   * attribute, two readers, so a row kind that stopped rendering it would break both visibly
   * rather than one of them silently.
   */
  lastRowId: string | null = null,
  /**
   * IS THE TRANSCRIPT ON SCREEN STILL SETTLING ONTO `viewKey` — rule 1's gate.
   *
   * ⚠ `loading || stale`, and the `stale` half is the one that matters. On a channel switch
   * `keepPreviousData` keeps the PREVIOUS channel's rows on screen with `isPending` FALSE, so
   * `loading` alone never sees the swap that this hook was landing in the middle of.
   * `use-channel-messages.ts › stale` is `isPlaceholderData` and is exactly that window.
   */
  settling = false
) {
  const pinned = useRef(true);
  /**
   * HAS THIS VIEW HAD ITS SETTLED LANDING — the flag that keeps rule 1 and rule 2 from
   * disagreeing. It is set by the first row commit that is NOT settling, so a channel open
   * spends it on the real transcript rather than on the placeholder that preceded it.
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
  // ⚠ LAYOUT, so the old view's scroll offset is never painted under the new
  // view's rows.
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
  // load-bearing: this is a LAYOUT effect and that one is passive, so on the commit where a
  // mention click both swapped the view and asked for a jump, the jump runs LAST and wins —
  // the same ordering the declaration comment there states, now held by phase as well as by
  // declaration order. `use-load-older.ts`'s anchor restore is a layout effect declared
  // between the two, so the three still run stick → anchor → jump.
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
     * For an ordinary short message the two are the same place and this reads as a smooth scroll to
     * bottom. For a message TALLER than the pane they are not, and jumping to `scrollHeight` lands
     * the reader on its last line — past the sender pill, mid-sentence, with no way to know they
     * are looking at the end of something. Aligning its top edge to the pane's puts the pill under
     * the top bound and the message reads from its beginning.
     * ⚠ CLAMPED TO THE SCROLLER'S OWN MAXIMUM, which is what makes the short case fall out for
     * free rather than needing a height test: a short row's desired offset is past the end, and
     * `min` turns it back into "the bottom".
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
    // ⚠ `scrollTo` IS NOT ASSUMED TO EXIST (2026-09-05). Every other move in this hook assigns
    // `scrollTop`, which is a plain property; this is the one call, and an environment without
    // it threw straight out of an effect — which React escalates to the nearest error boundary,
    // so the whole message pane unmounted and the transcript rendered as an error page rather
    // than as a missing animation. The fallback is the same destination without the easing.
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

  // Rule 3 — GROWTH KEEPS THE PIN. Content that gets taller without changing the
  // row count moves the bottom out from under a pinned reader, and no effect
  // above can see it: the deps did not change.
  // ⚠ THE SCROLLER'S CHILDREN, not the scroller: a `ResizeObserver` on the box
  // itself reports the BORDER box, which is exactly the measurement that does not
  // move when content grows inside an `overflow-y-auto`. The children are
  // re-observed whenever the pane swaps them (`rowCount` / `settling`), which is
  // also the commit where a new one appears.
  // ⚠ `typeof` GUARD: jsdom has no `ResizeObserver`, and an unguarded `new` here
  // throws out of an effect and unmounts the pane into an error boundary.
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

  // A pending follow timer must not outlive the pane (or the view): it writes a
  // ref nothing else clears, and rule 3 would stay locked out on the next mount.
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
