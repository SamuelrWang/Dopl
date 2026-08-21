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
 * argument is a SECOND pane, not a second file.
 *
 * ⚠ The slack constant lives here with the rule that reads it.
 */

import { useCallback, useEffect, useRef, type RefObject } from "react";

/**
 * How close to the bottom still counts as being AT the bottom. A reader who has
 * drifted a line is still following the conversation; one who has scrolled up
 * to read history is not, and yanking them down is the classic chat bug.
 */
const STICK_SLACK_PX = 64;

/**
 * STICK TO BOTTOM — the behaviour the retired page had and this pane lost at
 * the cutover. A transcript that renders oldest-first and never scrolls opens
 * on the oldest message in the channel, which is the wrong end of every chat
 * surface ever built.
 *
 * THREE RULES, and the third is the one the old page got wrong:
 *
 *  1. A CHANNEL OR THREAD SWITCH LANDS AT THE BOTTOM. A new view has no reading
 *     position to preserve, so there is nothing to be polite about.
 *  2. NEW ROWS FOLLOW, while the reader is at the bottom.
 *  3. ⚠ A READER SCROLLED UP IS NEVER YANKED. The old page followed
 *     unconditionally, so a message arriving mid-scrollback threw the reader
 *     back to the end of the conversation. The near-bottom guard is one
 *     subtraction and is strictly better.
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
 * statement of record now.
 *
 * Returns `release`, which the mention jump calls: a deliberate landing in
 * history is a reading position, and the next arriving message must not undo
 * it.
 */
export function useStickToBottom(
  scrollerRef: RefObject<HTMLDivElement | null>,
  /** Channel + thread — the identity of the VIEW, so a switch is one change. */
  viewKey: string,
  rowCount: number
) {
  const pinned = useRef(true);

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

  // Rule 1. Re-arms the pin as well as moving: the previous view's reading
  // position says nothing about this one.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    pinned.current = true;
    el.scrollTop = el.scrollHeight;
  }, [scrollerRef, viewKey]);

  // Rules 2 and 3. ⚠ DECLARED BEFORE THE SCROLL-TARGET EFFECT BELOW, which is
  // load-bearing: effects run in declaration order, so on the commit where a
  // mention click both swapped the view and asked for a jump, the jump runs
  // LAST and wins. A stick-to-bottom that ran afterwards would land the reader
  // at the newest message they did not ask for.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !pinned.current) return;
    el.scrollTop = el.scrollHeight;
  }, [scrollerRef, rowCount]);

  return useCallback(() => {
    pinned.current = false;
  }, []);
}

