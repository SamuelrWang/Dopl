"use client";

/** The Agents tab's peer-session poll and launch controls (the act is `use-launch-controls.ts`). */

import { useChannelAgentSessions } from "../hooks/use-channel-agent-sessions";
import { useLaunchControls, type LaunchSite } from "./use-launch-controls";
import type { Channel, ChannelThread } from "../types";

export {
  LAUNCH_APPROVAL_REASON,
  launchRefusalText,
  type AgentLaunchControls,
  type AgentLaunchOutcome,
  type LaunchAgentFn,
} from "./use-launch-controls";

/** `channel_sessions` is unpublished (INVARIANTS §7), so peers poll; shared so readers agree. */
export const PEER_SESSIONS_POLL_MS = 30_000;

export function useAgentsPanel({
  channel,
  workspaceId,
  currentUserId,
  threads,
  refreshDesktopSessions,
}: {
  channel: Channel | null;
  workspaceId: string;
  currentUserId: string;
  threads: ChannelThread[];
  /** The own-agent feed (`refetch` reads only peers); a belt for a child that never emits
   *  `system/init` — main's push is the primary path. */
  refreshDesktopSessions?: () => void;
}) {
  const { sessions: peerSessions, refetch } = useChannelAgentSessions(
    channel?.id ?? null,
    workspaceId,
    PEER_SESSIONS_POLL_MS
  );
  const site: LaunchSite | null = channel
    ? {
        channelId: channel.id,
        workspaceId,
        channelName: channel.name,
        direct: channel.isDirect,
        // The counterparty is the thread's OTHER party.
        thread: (threadId) => {
          const t = threads.find((row) => row.id === threadId);
          if (!t) return null;
          return {
            title: t.title,
            counterpartyId: t.createdBy === currentUserId ? t.targetUserId : t.createdBy,
          };
        },
      }
    : null;
  const launch = useLaunchControls(site, (outcome) => {
    if (outcome.ok) refreshDesktopSessions?.();
    void refetch();
  });

  return {
    ...launch,
    peerSessions,
    // Handed to the page's `refetchAll`, so peer cards ride the `channel_messages` doorbell.
    refetch,
  };
}
