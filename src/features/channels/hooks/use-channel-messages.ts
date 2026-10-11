"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/shared/api/api-client";
import { useApiQuery } from "@/shared/hooks/use-api-query";
import { useRefetchOnFocus } from "@/shared/hooks/use-refetch-on-focus";
import { CHANNEL_TRANSCRIPT_PAGE_MAX_ROWS } from "../constants";
import type { ChannelMessage, ChannelReadEntry } from "../types";
import { mergeDeltaPage, newestCachedSeq } from "../lib/transcript-delta";
import {
  appendOlderPage,
  dropThreadFromWindow,
  EMPTY_MESSAGE_WINDOW,
  foldedArtifactsOf,
  isContiguous,
  mergeEntries,
  mergeWindow,
  oldestSeq,
  type MessageWindow,
} from "../lib/message-window";
import { channelMessagesParams, channelMessagesPath } from "../client/query-keys";

/** The transcript route's body — `entries` is the ADDITIVE artifact envelope,
 *  `hasMore` the server's own "is there older history" (2026-09-08). */
interface TranscriptBody {
  messages: ChannelMessage[];
  entries?: ChannelReadEntry[] | null;
  hasMore?: boolean;
}

/** What one page IS once every key is defaulted. */
interface TranscriptPage {
  messages: ChannelMessage[];
  entries: ChannelReadEntry[] | null;
  hasMore: boolean;
}

/**
 * ⚠ **BOTH KEYS DEFAULTED HERE, AND `entries` IS THE §8 CASE, NOT A TIDY-UP.**
 * The query cache is IndexedDB-persisted with a 24h `gcTime`, so an entry written
 * by the PREVIOUS bundle — one that never heard of artifacts — is read by this
 * one on the first paint after an upgrade, with the key simply ABSENT.
 *
 * ⚠ MODULE-LEVEL AND STABLE: TanStack memoises a `select` result on
 * (data, select fn), so a per-render selector would move every memo below it.
 */
const selectPage = (body: TranscriptBody): TranscriptPage => ({
  messages: body.messages ?? [],
  entries: body.entries ?? null,
  // ⚠ **`?? true` MEANS "MAYBE MORE", AND THE DIRECTION IS THE POINT** — the §8
  // case again, for a key that did not exist before 2026-09-08. The two errors
  // are not symmetric: `false` HIDES history behind a cached page until the
  // revalidation lands; `true` costs at most one fetch that says otherwise.
  hasMore: body.hasMore ?? true,
});

/** Shared frozen empty — a fresh one per render would move the merge memo. */
const NO_PAGE: TranscriptPage = Object.freeze({
  messages: Object.freeze([]) as readonly ChannelMessage[] as ChannelMessage[],
  entries: null,
  // Nothing read yet, so nothing has said there is no history; `cursor` is `null`
  // here and `hasOlder` false regardless.
  hasMore: true,
});

/**
 * The scroll-back window plus the channel it belongs to, as ONE state value.
 *
 * ⚠ THE CHANNEL ID IS IN THE STATE BECAUSE A RESET-ON-SWITCH EFFECT IS NOT
 * AVAILABLE: `react-hooks/set-state-in-effect` is an ERROR in this tree, so a
 * mismatched id DERIVES the window back to empty during render instead. The stale
 * value is never read and the next page load replaces it.
 */
interface WindowState {
  channelId: string | null;
  window: MessageWindow;
  loading: boolean;
}

const IDLE: WindowState = {
  channelId: null,
  window: EMPTY_MESSAGE_WINDOW,
  loading: false,
};

/**
 * The selected channel's transcript, as a NEWEST PAGE plus however many pages of
 * history the reader has scrolled back through.
 *
 * **The newest page** is the ordinary `useApiQuery` read — no cursor, so the
 * server returns the newest page. ⚠ **SINCE 2026-09-08 THE PAGE IS SIZED IN
 * ESTIMATED RENDERED LINES, NOT IN ROWS** (Samuel: *"a message can be like 20
 * lines or it can be 2 lines … lets do 300 as the line chunk"*):
 * `client/query-keys.ts › channelMessagesParams` sends
 * `CHANNEL_TRANSCRIPT_LINE_BUDGET` beside `CHANNEL_TRANSCRIPT_PAGE_MAX_ROWS`,
 * the server trims to the budget, and **a page is therefore SHORT BY DESIGN —
 * whether more history exists is the SERVER's `hasMore`, never `rows.length`.**
 * Realtime re-runs it via `refetch` (refetch, don't merge), and it is the one
 * cache entry the optimistic writes patch; `keepPreviousData` holds the prior
 * channel's messages through a switch to avoid a blank flash.
 *
 * **A SWITCH-IN IS A DELTA, NOT A PAGE** (2026-10-10, option A) — {@link catchUp}
 * reads `since` the newest row the cache already holds and merges the 0-3 rows
 * that are new into the same entry. ⚠ **IT DOES NOT REPLACE THE REALTIME
 * REFETCH, AND MUST NOT.** A forward read can only ADD rows: it never sees an
 * older row edited or deleted while the reader was away, which is exactly what
 * the doorbell's full refetch is for.
 *
 * **The older pages** are fetched by {@link loadOlder} with a `before` keyset
 * cursor and held HERE rather than in the query cache — `lib/message-window.ts`
 * carries that argument. ⚠ **APPENDING AT THE BOTTOM IS UNTOUCHED BY ANY OF
 * THIS**: history is immutable and merged in FRONT of the newest page.
 *
 * `stale` is `isPlaceholderData` — true while the PREVIOUS channel's transcript is
 * on screen through a switch. Optimistic writes do not depend on it (they key off
 * the channel id captured at submit).
 */
export function useChannelMessages(
  channelId: string | null,
  workspaceId: string
) {
  const query = useApiQuery<TranscriptBody, TranscriptPage>(
    channelId ? channelMessagesPath(channelId) : null,
    {
      workspaceId,
      query: channelMessagesParams(),
      select: selectPage,
      keepPreviousData: true,
      /**
       * ⚠ **`Infinity` BECAUSE THIS HOOK OWNS REVALIDATION NOW (2026-10-10,
       * option A), AND IT IS NOT A RELAXATION.** It WAS an explicit `0` — a
       * stated correctness requirement (F-163), because realtime refetches only
       * the SELECTED channel and a channel opened 20s ago would otherwise render
       * stale on switch-back with nothing scheduled to correct it. {@link
       * catchUp} is now what corrects it, on every switch-in and on focus,
       * unconditionally rather than only when 30s happened to have passed.
       *
       * ⚠ **AND `0` WOULD NOW COST A DOUBLE READ.** An always-stale entry makes
       * TanStack fire a FULL newest-page read the moment the switch mounts, in
       * parallel with the delta — the 200-row read option A exists to avoid,
       * plus the delta. The two triggers have to be one.
       *
       * ⚠ **A PENDING ENTRY STILL FETCHES**: `staleTime` governs data that
       * EXISTS, so a first visit is the ordinary full read and needs no delta.
       */
      staleTime: Number.POSITIVE_INFINITY,
    }
  );
  const queryClient = useQueryClient();

  /**
   * THE SWITCH-IN TRIGGER'S MEMORY — the channel this hook has already fired a
   * catch-up for, which is also **WHAT IT IS POINTED AT NOW** (`null` for "nothing
   * is selected"). ⚠ DECLARED ABOVE {@link catchUp} because the fallback reads it.
   */
  const caughtUp = useRef<string | null>(null);

  /**
   * **THE FULL-PAGE FALLBACK, AIMED AT THE KEY THE DELTA WAS ISSUED FOR.**
   *
   * ⚠ **NOT `query.refetch`, AND THE DIFFERENCE IS THE WRONG CHANNEL'S READ
   * (fixed 2026-10-11).** TanStack binds an observer's `refetch` ONCE and it
   * fetches that observer's CURRENT query — not the key a delta was issued for. A
   * delta resolving after the reader had switched to B therefore refetched **B**:
   * A stayed un-caught-up and the channel just opened paid a full line-budgeted
   * page read, which is precisely the fast-switch cost this hook exists to remove.
   *
   * ⚠ **AND AFTER A DESELECT IT WAS A REQUEST AT A GARBAGE URL.** The observer's
   * current key is then `[null, …]`, whose `queryFn` calls `apiRequest(null)`.
   * `use-api-query-core.ts` wraps `refetch` in an `enabled` guard for exactly
   * that, but the wrapper CLOSES OVER `enabled` — captured `true` while the
   * channel was selected — so the guard cannot save a call made later.
   *
   * ⚠ **A DESELECTED READER GETS NO READ AT ALL, WHICH IS NOT A GAP.** A fallback
   * corrects a PAINT and there is none on screen; the entry is untouched by every
   * fallback arm (the ceiling arm deliberately merges nothing), so the next
   * switch-in re-reads the same delta and falls back then, when a reader is
   * actually looking at it.
   */
  const refetchPage = useCallback(
    (key: readonly unknown[]) => {
      if (caughtUp.current === null) return;
      void queryClient.refetchQueries({ queryKey: key, exact: true });
    },
    [queryClient]
  );

  /**
   * **CATCH THE CACHED TRANSCRIPT UP WITH ONE FORWARD READ** (2026-10-10, option
   * A of KB `dopl-development › Channel Switch Latency 2026-10-10`).
   *
   * Switching back to a channel used to repaint the cached rows instantly and
   * then wait on a FULL newest-page read — the whole delivery path for everything
   * that landed while the reader was away. The server has had the forward arm
   * since 2026-09-08 (`repository-messages.ts › listMessages`, `gt("seq", since)`)
   * and no client ever sent it. This sends it: `since` the newest row the cache
   * holds, so the switch-in payload is the 0-3 rows that are new.
   *
   * ⚠ **IMPERATIVE, AND IT MUST NOT BECOME A SECOND QUERY KEY.**
   * `client/query-keys.ts › channelMessagesParams` records the hazard: a second
   * entry under the prefix the optimistic writes patch makes every send append
   * its pending row into it. This fetches with `apiRequest` and merges into THE
   * SAME entry, the shape {@link loadOlder} already uses.
   *
   * ⚠ **NO `lineBudget` BESIDE `since` — the server REFUSES the pair**
   * (`schema-reads.ts`), because the budget keeps the newest suffix and would
   * leave a hole at the FRONT of an ascending page. `limit` alone is already
   * supported, so there is no server change here.
   *
   * ⚠ **THREE CASES FALL BACK TO THE FULL READ, AND ALL THREE HAVE TO.** (The
   * commit message counts FOUR by including the no-entry case below. That one
   * calls no fallback at all — the query's own read IS the page — so the number
   * of `refetchPage` arms here is three, and this list is the authority.)
   *   1. The delta came back AT its ceiling — more arrived than one page holds,
   *      so the rows are the OLDEST of the gap and the newest are still missing.
   *      Merging them would show a transcript that is wrong in the middle.
   *   2. The cache entry exists but holds no server row to read forward from.
   *   3. The fetch failed. Nothing else is scheduled to correct the paint, so a
   *      silent failure here is a transcript that stays in the past.
   *
   * ⚠ **NO CACHE ENTRY AT ALL IS NOT ONE OF THEM**: the query itself is pending
   * and its own read is the full page. Falling back here would double it.
   *
   * ⚠ **EVERY ARM FALLS BACK THROUGH {@link refetchPage} ON THE CAPTURED `key`**,
   * never through the observer's `refetch` — that one aims at whatever channel the
   * reader has since switched to.
   */
  const catchUp = useCallback(() => {
    if (!channelId) return;
    const path = channelMessagesPath(channelId);
    const key = [path, workspaceId, channelMessagesParams()] as const;
    const cached = queryClient.getQueryData<TranscriptBody>(key);
    if (cached === undefined) return;
    const since = newestCachedSeq(cached.messages);
    if (since === null) {
      refetchPage(key);
      return;
    }
    void apiRequest<TranscriptBody>(path, {
      workspaceId,
      query: { limit: CHANNEL_TRANSCRIPT_PAGE_MAX_ROWS, since },
    })
      .then((body) => {
        // ⚠ `?? true` FAILS TOWARD THE FULL READ, for the same reason
        // `selectPage` fails toward "maybe more": an older build omitting the key
        // costs one honest read, the other way paints a gap.
        if (body.hasMore ?? true) {
          refetchPage(key);
          return;
        }
        queryClient.setQueryData<TranscriptBody>(key, (prev) =>
          prev === undefined ? prev : mergeDeltaPage(prev, body)
        );
      })
      .catch(() => refetchPage(key));
  }, [channelId, workspaceId, queryClient, refetchPage]);

  /**
   * THE SWITCH-IN TRIGGER — once per channel the hook lands on.
   *
   * ⚠ **A REF, NOT A DEPENDENCY LIST.** An effect keyed on `catchUp` alone would
   * re-read the channel the reader is already sitting in every time that callback
   * were rebuilt. A→B→A still catches up: the ref holds B by then.
   *
   * ⚠ **AND THE WRITE BELOW IS WHAT {@link refetchPage} READS**, so the two
   * branches of this effect are also "there is a reader" / "there is not".
   */
  useEffect(() => {
    if (channelId === null) {
      caughtUp.current = null;
      return;
    }
    if (caughtUp.current === channelId) return;
    caughtUp.current = channelId;
    catchUp();
  }, [channelId, catchUp]);

  /**
   * AND ON FOCUS, which is the hole `staleTime: 0` used to cover: a machine that
   * slept with this channel open comes back to a socket that may have missed the
   * doorbell. ⚠ A DELTA, where the old behaviour was a full 200-row page.
   */
  useRefetchOnFocus(catchUp);
  const data = query.data ?? NO_PAGE;
  const page = data.messages;
  // ⚠ MEMOISED ON THE ENVELOPE: `mergeEntries` below is memoised on this array's
  // identity, and an ordinary channel gets the shared empty back
  // (`foldedArtifactsOf`), so the common case never moves at all.
  const pageArtifacts = useMemo(
    () => foldedArtifactsOf(data.entries),
    [data.entries]
  );

  const [state, setState] = useState<WindowState>(IDLE);
  // ⚠ DERIVED, NOT RESET. See {@link WindowState} — a channel switch reads as an
  // empty window in the same render pass, and the same expression drops a window
  // the newest page has OUTRUN (`lib/message-window.ts › isContiguous`) rather
  // than rendering a hole in the reader's history as if it were continuous.
  const mine = state.channelId === channelId ? state : IDLE;
  const window = isContiguous(mine.window, page)
    ? mine.window
    : EMPTY_MESSAGE_WINDOW;

  const messages = useMemo(() => mergeWindow(window, page), [window, page]);

  /**
   * THE ARTIFACT ENVELOPE FOR THE MERGED ARRAY — `lib/message-window.ts ›
   * mergeEntries` carries the whole argument.
   *
   * ⚠ REBUILT OVER `messages`, NOT FORWARDED FROM THE NEWEST PAGE. The route
   * describes the page it read; this hook renders that page plus history plus
   * every optimistic patch, and the consumer builds its ordinary rows from the
   * message arms ALONE — so forwarding one page's envelope drops history.
   */
  const entries = useMemo(
    () => mergeEntries(messages, window.artifacts, pageArtifacts),
    [messages, window.artifacts, pageArtifacts]
  );

  // ⚠ THE CURSOR IS THE OLDEST ROW LOADED, taken off the MERGED list so page N+1
  // continues from page N rather than re-reading the same block. Pending rows
  // cannot be it: they sort last by construction.
  const cursor = oldestSeq(messages);
  // ⚠ **NOT ONE OF THESE FACTS IS A ROW COUNT (2026-09-08).** `window.exhausted`
  // is the latched answer from the last `before` page, `data.hasMore` the newest
  // page's — both stamped by the SERVER (`server/service-reads.ts ›
  // readTranscript`), because a line-budgeted page is short by design and
  // `rows.length === pageSize` would report a channel of long messages as
  // exhausted on its very first screen.
  const hasOlder =
    !window.exhausted && data.hasMore && cursor !== null && channelId !== null;

  /**
   * FETCH THE PAGE IMMEDIATELY OLDER and prepend it.
   *
   * ⚠ **THE RE-ENTRY GUARD IS A REF, NOT `loading`, AND IT HAS TO BE.** The
   * caller is a scroll listener firing many times per frame; `loading` only
   * turns true after React commits, so every event in that window would fire its
   * own request. Released on BOTH settle paths — a guard left set is a
   * transcript that never pages again.
   *
   * ⚠ IT WRITES THE ABSOLUTE NEXT WINDOW, not a functional update: it extends the
   * CONTIGUITY-CHECKED window this render derived, and a functional update would
   * rebuild on top of one this render had already ruled unusable.
   *
   * ⚠ A FAILED PAGE IS SILENT — the reader scrolled rather than asked, the next
   * scroll retries, and `hasOlder` is unchanged so the affordance stays.
   */
  const inFlight = useRef(false);
  const loadOlder = useCallback(() => {
    if (!channelId || cursor === null || !hasOlder || inFlight.current) return;
    inFlight.current = true;
    setState({ channelId, window, loading: true });
    const settle = (next: MessageWindow) => {
      inFlight.current = false;
      setState({ channelId, window: next, loading: false });
    };
    void apiRequest<TranscriptBody>(channelMessagesPath(channelId), {
      workspaceId,
      query: { ...channelMessagesParams(), before: cursor },
    })
      .then((body) =>
        settle(
          appendOlderPage(
            window,
            // ⚠ `?? []` — the stale-cache rule's sibling on a LIVE payload: an
            // older build's route omits the key, and `.length` on `undefined`
            // throws inside a scroll handler.
            body.messages ?? [],
            cursor,
            // ⚠ THE SERVER'S FLAG, with `selectPage`'s "maybe more" fallback for
            // an older build: failing toward another fetch costs one read, the
            // other way hides history behind it.
            body.hasMore ?? true,
            // ⚠ THE KEY THIS FETCH USED TO DISCARD. A history page folds too, and
            // a card whose members are all in history is the whole reason
            // scroll-back was the hazard.
            body.entries ?? null
          )
        )
      )
      .catch(() => settle(window));
  }, [channelId, workspaceId, cursor, hasOlder, window]);

  /**
   * The window's half of the thread-delete cascade — see
   * `lib/message-window.ts › dropThreadFromWindow`. The cache entry's half is the
   * optimistic patch in `use-thread-lifecycle-writes.ts`; this half must be
   * CALLED, because the window is not in the cache that patch reaches.
   */
  const dropThread = useCallback(
    (threadId: string) =>
      setState((prev) =>
        prev.channelId === channelId
          ? { ...prev, window: dropThreadFromWindow(prev.window, threadId) }
          : prev
      ),
    [channelId]
  );

  return {
    messages,
    /**
     * THE FOLDED RENDERING OF `messages`, or `null` for "nothing here is folded".
     * ⚠ TOTAL OVER `messages` BY CONSTRUCTION — the two are one value and must
     * travel together.
     */
    entries,
    loading: channelId !== null && query.isPending,
    /** True while the rendered messages belong to the PREVIOUS channel. */
    stale: query.isPlaceholderData,
    refetch: query.refetch,
    /** The SERVER says more history exists to fetch — never a row count. */
    hasOlder,
    /** A `before` page is in flight. */
    loadingOlder: mine.loading,
    loadOlder,
    dropThread,
  };
}
