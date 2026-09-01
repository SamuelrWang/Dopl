"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { apiRequest } from "@/shared/api/api-client";
import { useApiQuery } from "@/shared/hooks/use-api-query";
import { CHANNEL_TRANSCRIPT_PAGE_SIZE } from "../constants";
import type { ChannelMessage } from "../types";
import {
  appendOlderPage,
  dropThreadFromWindow,
  EMPTY_MESSAGE_WINDOW,
  isContiguous,
  mergeWindow,
  oldestSeq,
  type MessageWindow,
} from "../lib/message-window";
import { channelMessagesParams, channelMessagesPath } from "../client/query-keys";

const selectMessages = (body: { messages: ChannelMessage[] }) =>
  body.messages ?? [];

/** Shared frozen empty — a fresh `[]` per render would move the merge memo. */
const NO_MESSAGES: ChannelMessage[] = [];

/**
 * The scroll-back window plus the channel it belongs to, as ONE state value.
 *
 * ⚠ THE CHANNEL ID IS IN THE STATE BECAUSE A RESET-ON-SWITCH EFFECT IS NOT
 * AVAILABLE: `react-hooks/set-state-in-effect` is an ERROR in this tree, so the
 * window is DERIVED back to empty during render when the id no longer matches
 * rather than cleared afterwards. The stale value is never read and is replaced
 * by the next page load.
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
 * **The newest page** is the ordinary `useApiQuery` read this hook has always
 * been — `CHANNEL_TRANSCRIPT_PAGE_SIZE` rows, no cursor, so the server returns
 * the newest page and a channel with more than a page of history still shows new
 * posts. Realtime re-runs it via `refetch` (refetch, don't merge), and it is the
 * one cache entry the optimistic writes patch. Disabled while no channel is
 * selected; keeps the prior channel's messages on screen through a channel
 * switch to avoid a blank flash.
 *
 * **The older pages** are fetched by {@link loadOlder} with a `before` keyset
 * cursor — `seq < oldest loaded` — and held HERE rather than in the query cache.
 * `lib/message-window.ts` carries that argument in full; the short version is
 * that a `?before=` cache entry sits under the prefix key every messages write
 * patches, so each send would append its pending row into every loaded page of
 * history.
 *
 * ⚠ **APPENDING AT THE BOTTOM IS UNTOUCHED BY ANY OF THIS.** New messages, the
 * optimistic pending row and its reconcile all land in the newest page's cache
 * entry exactly as before; history is immutable and is merged in FRONT of it.
 *
 * The path and query params come from `client/query-keys.ts`, which is also
 * where the optimistic writes build the key they patch — a send that appends a
 * pending row and a read that renders it must name the same cache entry, and a
 * key retyped by hand at one of the two ends is a silent no-op.
 *
 * `stale` is `isPlaceholderData`: true while `keepPreviousData` is showing the
 * PREVIOUS channel's transcript through a switch. Nothing read it before, which
 * is the open race where a channel switch renders the old channel's messages
 * with no sign that it is doing so. Optimistic writes do not depend on it (they
 * key off the channel id captured at submit), but a caller that needs to know
 * whether `messages` belongs to the channel it is rendering now can ask.
 */
export function useChannelMessages(
  channelId: string | null,
  workspaceId: string
) {
  const query = useApiQuery<{ messages: ChannelMessage[] }, ChannelMessage[]>(
    channelId ? channelMessagesPath(channelId) : null,
    {
      workspaceId,
      query: channelMessagesParams(),
      select: selectMessages,
      keepPreviousData: true,
      // EXPLICIT, and it is a correctness requirement, not a preference
      // (F-163). The realtime signal refetches only the SELECTED channel's
      // transcript, so every other channel's cache entry goes quietly out of
      // date while you read this one. On the app's 30s default, switching back
      // to a channel you had open 20s ago would render that entry with nothing
      // scheduled to correct it — a transcript silently missing the messages
      // that arrived in between. Serving the cache instantly is still what
      // happens; `0` only says the paint must be followed by a revalidation.
      staleTime: 0,
    }
  );
  const page = query.data ?? NO_MESSAGES;

  const [state, setState] = useState<WindowState>(IDLE);
  // ⚠ DERIVED, NOT RESET. See {@link WindowState} — a switch to another channel
  // reads as an empty window in the same render pass, with no effect and no
  // setState, and the same expression drops a window the newest page has
  // OUTRUN (`lib/message-window.ts › isContiguous`) rather than rendering a hole
  // in the reader's history as if it were continuous.
  const mine = state.channelId === channelId ? state : IDLE;
  const window = isContiguous(mine.window, page)
    ? mine.window
    : EMPTY_MESSAGE_WINDOW;

  const messages = useMemo(() => mergeWindow(window, page), [window, page]);

  // ⚠ THE CURSOR IS THE OLDEST ROW LOADED, taken off the MERGED list so page N+1
  // continues from page N rather than re-reading the same block. Pending rows
  // cannot be it: they sort last by construction.
  const cursor = oldestSeq(messages);
  const hasOlder = !window.exhausted && cursor !== null && channelId !== null;

  /**
   * FETCH THE PAGE IMMEDIATELY OLDER and prepend it.
   *
   * ⚠ **THE RE-ENTRY GUARD IS A REF, NOT `loading`, AND IT HAS TO BE.** The
   * caller is a scroll listener, which fires many times per frame; `loading`
   * only becomes true after React commits the `setState` below, so every event
   * in that window would read `false` and fire its own request. A ref is written
   * synchronously, inside the same tick, before anything can look. It is
   * released on BOTH settle paths — a `finally` in all but name — because a
   * guard left set is a transcript that never pages again.
   *

   * ⚠ IT WRITES THE ABSOLUTE NEXT WINDOW, not a functional update over whatever
   * is in state: the window it extends is the CONTIGUITY-CHECKED one this render
   * derived, and a functional update would silently rebuild on top of a window
   * this render had already ruled unusable.
   *
   * ⚠ A FAILED PAGE IS SILENT. There is no toast: the reader asked for nothing —
   * they scrolled — and the next scroll retries. `hasOlder` is unchanged, so the
   * affordance stays.
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
    void apiRequest<{ messages: ChannelMessage[] }>(
      channelMessagesPath(channelId),
      {
        workspaceId,
        query: { ...channelMessagesParams(), before: cursor },
      }
    )
      .then((body) =>
        settle(
          appendOlderPage(
            window,
            // ⚠ `?? []` — the stale-cache rule's sibling on a LIVE payload: an
            // older build's route answers this shape without the key rather than
            // with an empty array, and `.length` on `undefined` throws inside a
            // scroll handler.
            body.messages ?? [],
            cursor,
            CHANNEL_TRANSCRIPT_PAGE_SIZE
          )
        )
      )
      .catch(() => settle(window));
  }, [channelId, workspaceId, cursor, hasOlder, window]);

  /**
   * The window's half of the thread-delete cascade — see
   * `lib/message-window.ts › dropThreadFromWindow`. The cache entry's half is
   * the optimistic patch in `use-thread-lifecycle-writes.ts`; this one has to be
   * CALLED because the window is not in the cache the patch reaches.
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
    loading: channelId !== null && query.isPending,
    /** True while the rendered messages belong to the PREVIOUS channel. */
    stale: query.isPlaceholderData,
    refetch: query.refetch,
    /** More history exists to fetch (or: no page has come back short yet). */
    hasOlder,
    /** A `before` page is in flight. */
    loadingOlder: mine.loading,
    loadOlder,
    dropThread,
  };
}
