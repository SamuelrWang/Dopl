"use client";

import { useApiQuery } from "@/shared/hooks/use-api-query";
import { PRESENCE_ROSTER_BACKSTOP_MS } from "../constants";
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
 *
 * ⚠ **THE 60s `refetchInterval` IS A BACKSTOP, NOT THE MECHANISM** (2026-09-08).
 * Presence is decided SERVER-side now (`repository-collab.ts › derivePresence`),
 * so the rendered dot is a fact from the last payload rather than arithmetic the
 * client can redo — which means a MISSED realtime event no longer self-corrects,
 * it strands. `usePresenceRealtime` is still what makes presence feel live; this
 * bounds the failure to "up to 60s late" instead of "wrong until you switch
 * channels", which is §7's failure-with-no-error-shape applied to presence.
 * ⚠ It is TWO beats, deliberately longer than `PRESENCE_REFETCH_DEBOUNCE_MS`
 * (10s) so it cannot become a second, faster poll racing the debounced one.
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
