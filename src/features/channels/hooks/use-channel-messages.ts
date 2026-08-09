"use client";

import { useApiQuery } from "@/shared/hooks/use-api-query";
import type { ChannelMessage } from "../types";
import { channelMessagesParams, channelMessagesPath } from "../client/query-keys";

const selectMessages = (body: { messages: ChannelMessage[] }) =>
  body.messages ?? [];

/**
 * The selected channel's transcript: the LATEST `MAX_MESSAGE_LIMIT` messages,
 * ascending (no `since` cursor -> the server returns the newest page, so a
 * channel with more than a page of history still shows new posts). Disabled
 * while no channel is selected; keeps the prior channel's messages on screen
 * through a channel switch to avoid a blank flash. Realtime re-runs this via
 * `refetch` (refetch, don't merge).
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
  return {
    messages: query.data ?? [],
    loading: channelId !== null && query.isPending,
    /** True while the rendered messages belong to the PREVIOUS channel. */
    stale: query.isPlaceholderData,
    refetch: query.refetch,
  };
}
