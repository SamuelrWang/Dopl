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
import {
  canLaunchAgents,
  launchAgentOnThread,
} from "./agents-controls";
import type { Channel, ChannelThread } from "../../types";

/**
 * `channel_sessions` is unpublished (INVARIANTS §7), so the peer projection polls.
 *
 * ⚠ EXPORTED SINCE 2026-08-20, when the pop-out thread window became a second
 * reader (`thread-window.tsx`, for the peer-activity row). Two surfaces polling
 * one table on two different intervals is two answers to "how fresh is fresh
 * enough"; one exported number is the whole fix.
 */
export const PEER_SESSIONS_POLL_MS = 30_000;

/**
 * WHY A REFUSED LAUNCH NEEDS COPY (2026-08-20). `sessions:launch` answers
 * `{ ok: false, reason }` for five real conditions — main's own
 * `channel-dir-ipc.js › sessions:launch` and `session-engine.js › launch`
 * between them produce `no-counterparty`, `busy`, `cap`, `no-sdk` and
 * `auth-hold`, plus the bridge's own `no-bridge`. The result was DISCARDED, so a
 * launch main refused looked exactly like a launch that succeeded and had not
 * pushed yet: nothing appeared, and nothing said why.
 *
 * ⚠ ONE SHORT LINE EACH, per the minimal-copy ruling (INVARIANTS §5) — a label,
 * not an explanation. An unrecognized reason falls back rather than rendering a
 * raw enum at the operator.
 */
const LAUNCH_REFUSALS: Record<string, string> = {
  "no-bridge": "Not available here",
  "no-counterparty": "This thread has no other party",
  busy: "An agent is already on this thread",
  cap: "Session limit reached",
  "no-sdk": "No Claude runtime on this Mac",
  "auth-hold": "Sign in to Claude to start an agent",
  disabled: "Sessions are turned off",
};

export function launchRefusalText(reason: string | undefined): string {
  return (reason && LAUNCH_REFUSALS[reason]) || "Could not start the agent";
}

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
  const [launchBusy, setLaunchBusy] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

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
    // ⚠ Still a refusal, and it must SAY so — this used to return silently, which
    // is the same blank screen the discarded `{ ok: false }` produced.
    if (!counterpartyId) {
      setLaunchError(launchRefusalText("no-counterparty"));
      return;
    }
    setLaunchBusy(true);
    setLaunchError(null);
    try {
      const res = await launchAgentOnThread({
        channelId: channel.id,
        taskId: threadId,
        workspaceId,
        channelName: channel.name,
        threadTitle: thread?.title ?? null,
        counterpartyId,
        direct: channel.isDirect,
      });
      if (!res.ok) setLaunchError(launchRefusalText(res.reason));
      else refreshDesktopSessions?.();
      void refetch();
    } finally {
      setLaunchBusy(false);
    }
  };

  return {
    peerSessions,
    canLaunch: canLaunchAgents(),
    launchBusy,
    launchAgent,
    launchError,
    // Wave 3: the peer projection's re-read, handed to the page's `refetchAll` so
    // peer cards ride the `channel_messages` doorbell that is already paid for
    // instead of waiting out the 30s poll (INVARIANTS §7 — no new publication).
    refetch,
  };
}
