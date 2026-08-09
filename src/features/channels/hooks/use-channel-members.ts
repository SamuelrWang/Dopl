"use client";

import { useApiQuery } from "@/shared/hooks/use-api-query";
import type { ChannelMember } from "../types";
import { channelMembersPath } from "../client/query-keys";

const selectMembers = (body: { members: ChannelMember[] }) => body.members ?? [];

/**
 * The selected channel's roster — hydrated with presence (agentOnline /
 * lastSeenAt) so the header, the addressing picker, and the settings surface
 * can show who's listening. Disabled until a channel is selected. Realtime
 * refetch is driven by the parent (channels + presence signals) via `refetch`.
 *
 * `stale` is `isPlaceholderData`, the same shape `use-channel-messages` exposes
 * and for a sharper reason: this read is `keepPreviousData` too, so through a
 * channel switch `members` is the PREVIOUS channel's roster — and unlike the
 * transcript, which is merely shown, the roster is READ BY A WRITE. The
 * composer's request mode resolves a DM's peer out of it, so an immediate
 * request after a switch addressed the old channel's peer and came back 400
 * `ChannelAddresseeNotMemberError` with the optimistic row already painted.
 * Anything that turns this roster into a `toUserId` must ask.
 */
export function useChannelMembers(
  channelId: string | null,
  workspaceId: string
) {
  const query = useApiQuery<{ members: ChannelMember[] }, ChannelMember[]>(
    channelId ? channelMembersPath(channelId) : null,
    { workspaceId, select: selectMembers, keepPreviousData: true }
  );
  return {
    members: query.data ?? [],
    /** True while the rendered roster belongs to the PREVIOUS channel. */
    stale: query.isPlaceholderData,
    refetch: query.refetch,
  };
}
