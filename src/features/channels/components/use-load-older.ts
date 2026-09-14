"use client";

/**
 * SCROLL UP TO LOAD HISTORY — when the transcript scroller asks for the next
 * older page, and how the reader's place is kept when it arrives.
 *
 * ⚠ A SIBLING OF `use-stick-to-bottom.ts` AND THE OTHER HALF OF THE SAME RULE.
 * That hook owns the BOTTOM edge (follow new rows, never yank a reader who
 * scrolled away); this one owns the TOP edge (ask for more, never move the row
 * they were reading). They are separate files because they are separate
 * questions, and they are called from `message-pane.tsx` alone — one pane, one
 * implementation, the argument that file's docblock makes.
 *
 * ⚠ **DECLARE THIS AFTER `useStickToBottom` AND BEFORE THE SCROLL-TARGET
 * EFFECT.** Effects run in declaration order, so a commit that both prepends a
 * page and satisfies a mention jump must run: stick (no-op — a reader at the top
 * is not pinned), then the anchor restore, then the jump, which wins.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";

/**
 * How close to the top starts the next page. Deliberately NOT zero: a fetch
 * begun at `scrollTop === 0` is a fetch the reader is already waiting on, and
 * roughly one viewport of runway is what makes paging feel like scrolling rather
 * than like loading.
 */
const LOAD_MORE_SLACK_PX = 400;

/**
 * The row whose position must not move, and where it sat inside the scroller's
 * viewport when the page was asked for.
 *
 * ⚠ AN ELEMENT ANCHOR, NOT A `scrollHeight` DELTA, and the difference is not
 * cosmetic. The delta trick (`scrollTop += newHeight - oldHeight`) attributes ALL
 * growth to the top, so a message arriving at the BOTTOM while the page is in
 * flight — which is the normal state of a live channel — shoves the reader down
 * by exactly one message. Measuring the row itself is immune to anything that
 * happens below it.
 */
interface Anchor {
  messageId: string;
  /** Distance from the scroller's viewport top, in px, at request time. */
  offset: number;
}

/**
 * Fire `onLoad` as the reader nears the top, then hold their place when the page
 * lands.
 *
 * `topRowId` is the id of the row currently FIRST in the transcript — the same
 * `data-message-id` the rows render and the mention jump queries. It is the
 * anchor, and passing it in rather than reading `firstElementChild` keeps the
 * hook honest about the notices and indicators the pane also puts in the
 * scroller.
 *
 * ⚠ REFS, NOT STATE, for the same reason `use-stick-to-bottom.ts` gives: an
 * anchor held in state would re-render the whole transcript on every scroll
 * event to decide something nothing renders, and `react-hooks/set-state-in-effect`
 * is an error in this tree.
 */
export function useLoadOlder(
  scrollerRef: RefObject<HTMLDivElement | null>,
  {
    canLoad,
    loading,
    topRowId,
    rowCount,
    onLoad,
  }: {
    /** More history exists AND a channel is selected. */
    canLoad: boolean;
    /** A page is already in flight. */
    loading: boolean;
    topRowId: string | null;
    /** Changes when rows are added at either end — the restore's trigger. */
    rowCount: number;
    onLoad: () => void;
  }
) {
  const anchorRef = useRef<Anchor | null>(null);
  // ⚠ The scroll listener is registered ONCE per scroller and must see the
  // LATEST props; re-subscribing on every render instead would drop events
  // between teardown and re-add.
  const latest = useRef({ canLoad, loading, topRowId, onLoad });
  useEffect(() => {
    latest.current = { canLoad, loading, topRowId, onLoad };
  });

  const requestOlder = useCallback(() => {
    const el = scrollerRef.current;
    const { canLoad: can, loading: busy, topRowId: id, onLoad: load } = latest.current;
    // ⚠ `anchorRef.current !== null` IS THE RE-ENTRY GATE for a scroll burst
    // whose `loading` prop has not caught up yet — but it is only a first line:
    // a transcript with no anchorable row takes none, so the true idempotency
    // lives in `use-channel-messages.ts › loadOlder`, which is safe to call
    // twice.
    if (!el || !can || busy || anchorRef.current !== null) return;
    // ⚠ THE ANCHOR IS TAKEN BEFORE THE REQUEST, not when it returns: by then the
    // rows have already moved and there is nothing left to measure.
    const row = id
      ? el.querySelector<HTMLElement>(`[data-message-id="${id}"]`)
      : null;
    if (row && id) {
      anchorRef.current = {
        messageId: id,
        offset: row.getBoundingClientRect().top - el.getBoundingClientRect().top,
      };
    }
    load();
  }, [scrollerRef]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      if (el.scrollTop <= LOAD_MORE_SLACK_PX) requestOlder();
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [scrollerRef, requestOlder]);

  // ⚠ LAYOUT effect, so the restore happens BEFORE paint. On `useEffect` the
  // browser paints one frame with the reader thrown to the top of a page of
  // history they did not ask to be in, and then snaps back — the jump this whole
  // hook exists to prevent, merely made brief.
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const el = scrollerRef.current;
    if (!anchor || !el) return;
    const row = el.querySelector<HTMLElement>(
      `[data-message-id="${anchor.messageId}"]`
    );
    // ⚠ The anchor is cleared EITHER WAY. A row that did not come back (the
    // thread it belonged to was deleted under the fetch) is a lost reading
    // position, not a reason to hold the gate shut against every later page.
    anchorRef.current = null;
    if (!row) return;
    const now = row.getBoundingClientRect().top - el.getBoundingClientRect().top;
    el.scrollTop += now - anchor.offset;
  }, [scrollerRef, rowCount]);

  // ⚠ THE GATE MUST NOT SURVIVE A PAGE THAT ADDED NOTHING. A `before` read that
  // came back empty, or failed, changes no `rowCount`, so the restore above never
  // runs and the anchor would stand forever — with `requestOlder` refusing every
  // later page and the transcript silently stuck at whatever the reader had.
  // Releasing on the loading edge closes that, and is a no-op on the ordinary
  // path where the layout effect above already cleared it in the same commit.
  useEffect(() => {
    if (!loading) anchorRef.current = null;
  }, [loading]);
}
