"use client";

import { useApiQuery } from "@/shared/hooks/use-api-query";
import type { ChannelThread } from "../types";

// BOUNDARY: wire/storage name `task` == domain name `thread`. The route path
// and the response envelope key stay `tasks` (storage names); everything this
// hook hands back is a `thread`.
const selectThreads = (body: { tasks: ChannelThread[] }) => body.tasks ?? [];

/**
 * The selected channel's threads — the authoritative status / title / mode
 * store the transcript overlays onto message groups. Disabled until a channel
 * is selected. Realtime refetch is driven by the parent (`channel_messages` +
 * thread signals) via `refetch`, mirroring `use-channel-members`.
 */
export function useChannelThreads(
  channelId: string | null,
  workspaceId: string
) {
  const query = useApiQuery<{ tasks: ChannelThread[] }, ChannelThread[]>(
    channelId ? `/api/channels/${encodeURIComponent(channelId)}/tasks` : null,
    { workspaceId, select: selectThreads, keepPreviousData: true }
  );
  return {
    threads: query.data ?? [],
    // `loading` gates the transcript's status-flicker suppression: an open
    // thread's authoritative overlay isn't known until this first load
    // resolves.
    loading: query.isLoading,
    refetch: query.refetch,
  };
}
