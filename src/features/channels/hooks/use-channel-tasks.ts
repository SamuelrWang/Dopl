"use client";

import { useApiQuery } from "@/shared/hooks/use-api-query";
import type { ChannelTask } from "../types";

const selectTasks = (body: { tasks: ChannelTask[] }) => body.tasks ?? [];

/**
 * The selected channel's tasks — the authoritative status / title / mode store
 * the thread overlays onto message groups. Disabled until a channel is
 * selected. Realtime refetch is driven by the parent (`channel_messages` +
 * task signals) via `refetch`, mirroring `use-channel-members`.
 */
export function useChannelTasks(channelId: string | null, workspaceId: string) {
  const query = useApiQuery<{ tasks: ChannelTask[] }, ChannelTask[]>(
    channelId ? `/api/channels/${encodeURIComponent(channelId)}/tasks` : null,
    { workspaceId, select: selectTasks, keepPreviousData: true }
  );
  return {
    tasks: query.data ?? [],
    // `loading` gates the thread's status-flicker suppression: an open task's
    // authoritative overlay isn't known until this first load resolves.
    loading: query.isLoading,
    refetch: query.refetch,
  };
}
