"use client";

import { useApiQuery } from "@/shared/hooks/use-api-query";
import { PRESENCE_ROSTER_BACKSTOP_MS } from "../constants";
import type { ChannelMember } from "../types";
import { channelMembersPath } from "../client/query-keys";

const selectMembers = (body: { members: ChannelMember[] }) => body.members ?? [];

/**
 * The selected channel's roster, hydrated with presence (agentOnline /
 * lastSeenAt). Disabled while no channel is selected; realtime refetch is driven
 * by the parent via `refetch`.
 *
 * ⚠ `keepPreviousData`, so through a switch `members` is the PREVIOUS channel's
 * roster — and this roster is READ BY A WRITE: the composer's request mode
 * resolves a DM's peer out of it, so a request right after a switch addressed the
 * old peer and came back 400 `ChannelAddresseeNotMemberError` over an
 * already-painted optimistic row. `stale` is the check; anything that turns this
 * roster into a `toUserId` must ask.
 *
 * ⚠ **THE 60s `refetchInterval` IS A BACKSTOP, NOT THE MECHANISM** (2026-09-08).
 * Presence is decided SERVER-side (`repository-collab.ts › derivePresence`), so a
 * MISSED realtime event strands rather than self-correcting; this bounds it to
 * "60s late" — §7's failure-with-no-error-shape applied to presence. ⚠ It is
 * deliberately longer than `PRESENCE_REFETCH_DEBOUNCE_MS` (10s) so it cannot
 * become a second, faster poll racing the debounced one.
 */
export function useChannelMembers(
  channelId: string | null,
  workspaceId: string
) {
  const query = useApiQuery<{ members: ChannelMember[] }, ChannelMember[]>(
    channelId ? channelMembersPath(channelId) : null,
    {
      workspaceId,
      select: selectMembers,
      keepPreviousData: true,
      refetchInterval: PRESENCE_ROSTER_BACKSTOP_MS,
    }
  );
  return {
    members: query.data ?? [],
    /** True while the rendered roster belongs to the PREVIOUS channel. */
    stale: query.isPlaceholderData,
    refetch: query.refetch,
  };
}
