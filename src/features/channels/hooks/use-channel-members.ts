"use client";

import { useApiQuery } from "@/shared/hooks/use-api-query";
import type { ChannelMember } from "../types";

const selectMembers = (body: { members: ChannelMember[] }) => body.members ?? [];

/**
 * The selected channel's roster — hydrated with presence (agentOnline /
 * lastSeenAt) so the header, the addressing picker, and the settings surface
 * can show who's listening. Disabled until a channel is selected. Realtime
 * refetch is driven by the parent (channels + presence signals) via `refetch`.
 */
export function useChannelMembers(
  channelId: string | null,
  workspaceId: string
) {
  const query = useApiQuery<{ members: ChannelMember[] }, ChannelMember[]>(
    channelId ? `/api/channels/${encodeURIComponent(channelId)}/members` : null,
    { workspaceId, select: selectMembers, keepPreviousData: true }
  );
  return {
    members: query.data ?? [],
    refetch: query.refetch,
  };
}
