"use client";

import { useApiQuery } from "@/shared/hooks/use-api-query";
import type { ChannelThread } from "../types";
import { channelThreadsPath } from "../client/query-keys";

// BOUNDARY: wire/storage name `task` == domain name `thread`. The route path
// and the response envelope key stay `tasks` (storage names); everything this
// hook hands back is a `thread`.
//
// The READ path returns the thread rows and nothing else. It used to return a
// `ChannelThreadDetail` — the row PLUS its participant set — which the rooms
// sidebar read for its "N participants" line; breakout rooms are gone
// (rollback §1) and so is the extra shape. Typed here so the endpoint's real
// shape survives the client boundary instead of riding along untyped.
// ⚠ THE ENVELOPE ALSO CARRIES `truncated`, AND IT IS NOW CARRIED THROUGH. The
// selector used to drop it, on the grounds that the only consumer was the
// transcript's status OVERLAY, which looks threads up by id and asserts nothing
// about the set being complete. **Any surface that presents this as A LIST OF
// THE CHANNEL'S THREADS must read `truncated` and say so** (INVARIANTS §9: a
// cap that renders identically to an exhausted list is the bug), and the v2
// Threads tab (`components/channels-v2/threads-tab.tsx`) is that surface. The
// server orders by last activity and bounds the page at
// `constants.ts › CHANNEL_THREAD_LIST_LIMIT`.
//
// ⚠ The SELECT shape changed, the RAW cache entry did not: the optimistic
// thread patches operate on the response body (`{ tasks }`) and are untouched
// (INVARIANTS §8 — patches operate on the raw body, `select` applies on read).
const selectThreads = (body: { tasks: ChannelThread[]; truncated?: boolean }) => ({
  threads: body.tasks ?? [],
  truncated: body.truncated === true,
});

/** Stable identity for the not-yet-loaded case (a fresh [] would churn memos). */
const NO_THREADS: ChannelThread[] = [];

/**
 * The selected channel's threads — the authoritative status / title / mode
 * store the transcript overlays onto message groups. Disabled until a channel
 * is selected. Realtime refetch is driven by the parent (`channel_messages` +
 * thread signals) via `refetch`, mirroring `use-channel-members`.
 *
 * The path comes from `client/query-keys.ts` — the same builder
 * `channelKeys.threads()` keys the optimistic thread patches with. It was
 * retyped by hand here and happened to be byte-identical; a key that differs
 * by one character is a silent no-op, so the two ends name it once.
 */
export function useChannelThreads(
  channelId: string | null,
  workspaceId: string
) {
  const query = useApiQuery<
    { tasks: ChannelThread[]; truncated?: boolean },
    { threads: ChannelThread[]; truncated: boolean }
  >(
    channelId ? channelThreadsPath(channelId) : null,
    {
      workspaceId,
      select: selectThreads,
      keepPreviousData: true,
      // Paired with `use-channel-messages`' own `staleTime: 0`, and for the
      // same reason (F-163): realtime refetches only the selected channel, so
      // a 30s-cached entry for the channel you switch BACK to has nothing
      // scheduled to correct it. These two reads must also agree with each
      // other — this is the authoritative status/title overlay the transcript
      // renders on top of message groups, so a fresh transcript under a
      // 30s-old overlay shows closed threads as open.
      staleTime: 0,
    }
  );
  return {
    threads: query.data?.threads ?? NO_THREADS,
    /** ⚠ The read came back AT its ceiling — which counts as clipped, because
     *  at is indistinguishable from over. A caller that LISTS threads must say
     *  so (INVARIANTS §9); one that looks a thread up by id may ignore it. */
    truncated: query.data?.truncated ?? false,
    // `loading` gates the transcript's status-flicker suppression: an open
    // thread's authoritative overlay isn't known until this first load
    // resolves.
    loading: query.isLoading,
    refetch: query.refetch,
  };
}
