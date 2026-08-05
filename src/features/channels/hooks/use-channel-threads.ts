"use client";

import { useApiQuery } from "@/shared/hooks/use-api-query";
import type { ChannelThread } from "../types";

// BOUNDARY: wire/storage name `task` == domain name `thread`. The route path
// and the response envelope key stay `tasks` (storage names); everything this
// hook hands back is a `thread`.
//
// The READ path returns the thread rows and nothing else. It used to return a
// `ChannelThreadDetail` — the row PLUS its participant set — which the rooms
// sidebar read for its "N participants" line; breakout rooms are gone
// (rollback §1) and so is the extra shape. Typed here so the endpoint's real
// shape survives the client boundary instead of riding along untyped.
const selectThreads = (body: { tasks: ChannelThread[] }) =>
  body.tasks ?? [];

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
  const query = useApiQuery<
    { tasks: ChannelThread[] },
    ChannelThread[]
  >(
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
