"use client";

/**
 * The Agents tab's DATA + LAUNCH wiring (Samuel, 2026-08-20), split out of
 * `channels-core.tsx` at the 500-line cap: the peer-session poll (every
 * member's state projection for the open channel) and the "New Agent"
 * action — start MY OWN agent on a thread, windowless, main owning the
 * posture. The act itself is `use-launch-controls.ts`, shared with the agent
 * pop-out's `+`.
 */

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

/**
 * `channel_sessions` is unpublished (INVARIANTS §7), so the peer projection polls.
 *
 * ⚠ EXPORTED SINCE 2026-08-20, when the pop-out thread window became a second
 * reader (`thread-window.tsx`, for the peer-activity row). Two surfaces polling
 * one table on two different intervals is two answers to "how fresh is fresh
 * enough"; one exported number is the whole fix.
 */
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
  /**
   * ⚠ THE OWN-AGENT FEED, AND IT IS A DIFFERENT SOURCE FROM `refetch` BELOW.
   * `refetch` re-reads the PEER projection (`channel_sessions` over HTTP), which
   * excludes this operator's own sessions by construction — so it can never show
   * the agent this button just launched. Main now touches its projection at
   * REGISTRATION (`session-engine.js › startSession`), which makes the push the
   * primary path; this is the belt for the one case a push cannot cover, a child
   * that boots and never emits `system/init` (`session-query.js`'s C-4 note).
   */
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
        // My agent's counterparty is the thread's OTHER party — the target when I asked, the
        // asker when I was asked.
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
    // Wave 3: the peer projection's re-read, handed to the page's `refetchAll` so
    // peer cards ride the `channel_messages` doorbell that is already paid for
    // instead of waiting out the 30s poll (INVARIANTS §7 — no new publication).
    refetch,
  };
}
