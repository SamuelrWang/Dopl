"use client";

/**
 * STAGING STUB of `src/features/channels/hooks/use-channel-members.ts`. Only `workspaceRole` and
 * the name fields are read by the knowledge settings modal; the rest is filled neutrally.
 */
import { useMemo } from "react";
import type { ChannelMember } from "@/features/channels/types";
import { CHANNEL_ROSTERS } from "../data";

export function useChannelMembers(channelId: string | null, workspaceId: string) {
  void workspaceId;
  const members = useMemo<ChannelMember[]>(
    () =>
      (channelId ? (CHANNEL_ROSTERS[channelId] ?? []) : []).map(
        (m) =>
          ({
            channelId,
            userId: m.userId,
            role: m.workspaceRole === "owner" ? "owner" : "member",
            workspaceRole: m.workspaceRole,
            lastReadAt: null,
            notifyScope: null,
            agentToolProfile: null,
            myFavoritedAt: null,
            agentOnline: false,
            lastSeenAt: null,
            addedBy: null,
            joinedAt: "2026-09-01T00:00:00.000Z",
            displayName: m.displayName,
            email: null,
            avatarUrl: null,
          }) as unknown as ChannelMember
      ),
    [channelId]
  );
  return { members, stale: false, refetch: () => {} };
}
