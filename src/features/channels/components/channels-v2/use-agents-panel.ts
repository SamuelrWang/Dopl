"use client";

/**
 * The Agents tab's DATA + LAUNCH wiring (Samuel, 2026-08-20), split out of
 * `channels-v2-core.tsx` at the 500-line cap: the peer-session poll (every
 * member's state projection for the open channel) and the "New Agent"
 * action — start MY OWN agent on a thread, windowless, main owning the
 * posture.
 *
 * ⚠ ONE LAUNCH IN FLIGHT, NOT ONE AGENT PER THREAD (2026-08-21). `launchBusy` is
 * a double-submit guard over a single click and nothing more; a thread may carry
 * as many of this operator's agents as main will spawn, and no state here caps
 * that or re-arms after the first.
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
 * `{ ok: false, reason }` for SEVEN real conditions — main's own
 * `session-ipc-ops.js › sessions:launch` and `session-engine.js › launch`
 * between them produce `no-counterparty`, `busy`, `cap`, `no-sdk`, `auth-hold`
 * and `disabled`, plus the bridge's own `no-bridge`. The result was DISCARDED, so
 * a launch main refused looked exactly like a launch that succeeded and had not
 * pushed yet: nothing appeared, and nothing said why.
 *
 * ⚠ THE COUNT IS THE MAP'S OWN LENGTH — this docblock said "five" while listing
 * six and keying seven, which is what a hand-maintained number does. Read the
 * keys; INVARIANTS §11 states the same set from main's side.
 *
 * ⚠ ONE SHORT LINE EACH, per the minimal-copy ruling (INVARIANTS §5) — a label,
 * not an explanation. An unrecognized reason falls back rather than rendering a
 * raw enum at the operator.
 */
const LAUNCH_REFUSALS: Record<string, string> = {
  "no-bridge": "Not available here",
  "no-counterparty": "This thread has no other party",
  // ⚠ IT NO LONGER MEANS "one agent per thread" (2026-08-21). Every click mints a
  // NEW agent, so the old copy — "An agent is already on this thread" — would
  // state a rule the product just dropped, beside a button that is still enabled
  // and about to work. What main can still be is momentarily unable to start one.
  busy: "Busy right now — try again",
  cap: "Session limit reached",
  "no-sdk": "No Claude runtime on this Mac",
  "auth-hold": "Sign in to Claude to start an agent",
  // ⚠ REACHABLE, and NOT a settings state. It is the `attachSurface` rollback —
  // the spawn was refused on the way up. The old copy ("Sessions are turned off")
  // described the deleted session-window master switch and sent the operator
  // looking for a toggle that no longer exists.
  disabled: "The agent could not be started",
};

export function launchRefusalText(reason: string | undefined): string {
  return (reason && LAUNCH_REFUSALS[reason]) || "Could not start the agent";
}

/**
 * THE LAUNCH HALF OF THIS HOOK, as the shape a second surface can take
 * (2026-08-21). The composer's Bot icon starts an agent exactly as the Agents
 * tab's New Agent button does, and it takes THIS OBJECT rather than mounting its
 * own `useAgentsPanel`: a second mount would be a second peer poll of
 * `channel_sessions` on its own interval — two answers to "how fresh is fresh
 * enough" — which is the same argument `PEER_SESSIONS_POLL_MS` was exported on.
 *
 * ⚠ `useAgentsPanel`'s return satisfies it STRUCTURALLY, so there is nothing to
 * keep in step: the page hands the panel down and the type checks it.
 */
export interface AgentLaunchControls {
  /** The bridge op exists on this build. Absent ⇒ offer no control at all. */
  canLaunch: boolean;
  launchBusy: boolean;
  /** The last refusal's copy, or null. ⚠ Never swallowed — a refusal is not a
   *  push, so the button's own surface is the only place it can be said. */
  launchError: string | null;
  /** `null` starts a CHANNEL-LEVEL agent; a thread id starts one on it. */
  launchAgent: (threadId: string | null) => Promise<void>;
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

  const launchAgent = async (threadId: string | null) => {
    if (!channel || launchBusy) return;
    const thread = threadId ? (threads.find((t) => t.id === threadId) ?? null) : null;
    // My agent's counterparty is the thread's OTHER party — the target when I
    // asked, the asker when I was asked. A thread I'm not party to has none.
    const counterpartyId = thread
      ? thread.createdBy === currentUserId
        ? thread.targetUserId
        : thread.createdBy
      : null;
    // ⚠ A CHANNEL-LEVEL AGENT HAS NO COUNTERPARTY AND THAT IS NOT A REFUSAL
    // (2026-08-21, the composer's Bot icon in channel view). It is an agent on
    // the ROOM: nobody is on the other side of it, because there is no exchange
    // yet. The refusal below is about a THREAD whose other party could not be
    // resolved, which is a different fact and still has to be said — this used
    // to return silently, the same blank screen a discarded `{ok:false}` gave.
    if (threadId !== null && !counterpartyId) {
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
