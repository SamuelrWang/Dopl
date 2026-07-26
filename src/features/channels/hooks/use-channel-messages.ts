"use client";

import { useApiQuery } from "@/shared/hooks/use-api-query";
import type { ChannelMessage } from "../types";
import { MAX_MESSAGE_LIMIT } from "../constants";

const selectMessages = (body: { messages: ChannelMessage[] }) =>
  body.messages ?? [];

/**
 * The selected channel's transcript: the LATEST `MAX_MESSAGE_LIMIT` messages,
 * ascending (no `since` cursor -> the server returns the newest page, so a
 * channel with more than a page of history still shows new posts). Disabled
 * while no channel is selected; keeps the prior channel's messages on screen
 * through a channel switch to avoid a blank flash. Realtime re-runs this via
 * `refetch` (refetch, don't merge).
 */
export function useChannelMessages(
  channelId: string | null,
  workspaceId: string
) {
  const query = useApiQuery<{ messages: ChannelMessage[] }, ChannelMessage[]>(
    channelId ? `/api/channels/${encodeURIComponent(channelId)}/messages` : null,
    {
      workspaceId,
      query: { limit: MAX_MESSAGE_LIMIT },
      select: selectMessages,
      keepPreviousData: true,
    }
  );
  return {
    messages: query.data ?? [],
    loading: channelId !== null && query.isPending,
    refetch: query.refetch,
  };
}
