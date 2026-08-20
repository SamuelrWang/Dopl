"use client";

/**
 * The Agents tab's DATA + LAUNCH wiring (Samuel, 2026-08-20), split out of
 * `channels-v2-core.tsx` at the 500-line cap: the peer-session poll (every
 * member's state projection for the open channel) and the "Launch agent"
 * action — attach MY OWN agent to a thread, windowless, main owning the
 * posture. One launch in flight at a time; the button says so.
 */

import { useState } from "react";
import { useChannelAgentSessions } from "../../hooks/use-channel-agent-sessions";
import { canLaunchAgents, launchAgentOnThread } from "./agents-model";
import type { Channel, ChannelThread } from "../../types";

/** `channel_sessions` is unpublished (INVARIANTS §7), so the tab polls. */
const PEER_SESSIONS_POLL_MS = 30_000;

export function useAgentsPanel({
  channel,
  workspaceId,
  currentUserId,
  threads,
}: {
  channel: Channel | null;
  workspaceId: string;
  currentUserId: string;
  threads: ChannelThread[];
}) {
  const { sessions: peerSessions, refetch } = useChannelAgentSessions(
    channel?.id ?? null,
    workspaceId,
    PEER_SESSIONS_POLL_MS
  );
  const [launchBusy, setLaunchBusy] = useState(false);

  const launchAgent = async (threadId: string) => {
    if (!channel || launchBusy) return;
    const thread = threads.find((t) => t.id === threadId) ?? null;
    // My agent's counterparty is the thread's OTHER party — the target when I
    // asked, the asker when I was asked. A thread I'm not party to has none.
    const counterpartyId = thread
      ? thread.createdBy === currentUserId
        ? thread.targetUserId
        : thread.createdBy
      : null;
    if (!counterpartyId) return; // a thread with no other party has nothing to converse with
    setLaunchBusy(true);
    try {
      await launchAgentOnThread({
        channelId: channel.id,
        taskId: threadId,
        workspaceId,
        channelName: channel.name,
        threadTitle: thread?.title ?? null,
        counterpartyId,
        direct: channel.isDirect,
      });
      void refetch();
    } finally {
      setLaunchBusy(false);
    }
  };

  return { peerSessions, canLaunch: canLaunchAgents(), launchBusy, launchAgent };
}
