"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { apiRequest } from "@/shared/api/api-client";
import { useApiQuery } from "@/shared/hooks/use-api-query";
import type { ChannelMessage, ChannelReadEntry } from "../types";
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
      // EXPLICIT, and a correctness requirement rather than a preference
      // (F-163). Realtime refetches only the SELECTED channel, so on the app's
      // 30s default, switching back to a channel opened 20s ago would render a
      // stale entry with nothing scheduled to correct it. The cache is still
      // served instantly; `0` only says the paint must be revalidated.
      staleTime: 0,
    }
  );
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
