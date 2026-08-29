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
  approveTemplate,
  canLaunchAgents,
  launchAgentOnThread,
} from "./agents-controls";
import type { Channel, ChannelThread } from "../../types";
import type { TemplateLaunchOverrides } from "@/features/agent-templates/lib/launch-overrides";

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
  // ⚠ THE TEMPLATE PICKER'S OWN REFUSAL (2026-08-22). Main resolves the template
  // ITSELF at spawn, so a template deleted — or narrowed out of this operator's
  // visibility — between the picker row rendering and the click answers 404, and
  // main REFUSES rather than degrading to a blank agent: the operator picked an
  // IDENTITY, and an agent silently wearing none is worse than nothing because
  // nobody notices for several turns. The endpoint deliberately cannot tell
  // "deleted" from "invisible" (404-never-403), so neither can this copy.
  "no-template": "That template is gone — reload the list",
};

/**
 * ⚠ NOT A REFUSAL — A QUESTION, AND THE ONE WORD THIS MAP MUST NOT CARRY. Main
 * answers it for the FIRST launch of another member's template on this machine,
 * with `{ template: { name, instructions } }` for the approval modal to show
 * verbatim (`agent-templates/components/template-approval.tsx`). Rendering
 * "could not start the agent" underneath a modal that is asking permission would
 * report the question as a failure, so `launchAgent` deliberately leaves
 * `launchError` alone for this one word and hands the outcome back to the caller.
 */
export const LAUNCH_APPROVAL_REASON = "template-approval";

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
export interface AgentLaunchOutcome {
  ok: boolean;
  reason?: string;
  /**
   * THE ADDRESS MAIN CREATED, on a successful launch (2026-08-27).
   *
   * ⚠ IT IS MAIN'S ANSWER, NEVER AN ECHO OF THE ASK. A caller that pre-assigned an id
   * (the composer's launch panel) still paints THIS — a desktop older than the forward in
   * `main/session-launch-op.js` mints its own and says so here, and that is exactly the arm
   * the panel's fallback exists for. Same never-echo rule `rename` / `setMode` / `setModel`
   * follow. ⚠ Absent when the build could not say; read it optionally.
   */
  agentId?: string;
  /** Rides {@link LAUNCH_APPROVAL_REASON} only. Read tolerantly. */
  template?: { name?: string | null; instructions?: string | null } | null;
}

export interface AgentLaunchControls {
  /** The bridge op exists on this build. Absent ⇒ offer no control at all. */
  canLaunch: boolean;
  launchBusy: boolean;
  /** The last refusal's copy, or null. ⚠ Never swallowed — a refusal is not a
   *  push, so the button's own surface is the only place it can be said. */
  launchError: string | null;
  /**
   * `null` starts a CHANNEL-LEVEL agent; a thread id starts one on it.
   *
   * ⚠ `templateId` AND `overrides` ARE BOTH OPTIONAL AND THE ZERO-ARGUMENT CALL
   * IS THE PINNED ONE (2026-08-22). `launchAgent(threadId)` still spawns a BLANK
   * agent with a byte-identical payload, because that is what the New Agent
   * button and the composer's Bot icon do in ONE CLICK and Samuel's channels-v2
   * ruling is that they keep doing it. The picker is a second, adjacent control.
   *
   * ⚠ IT RETURNS THE OUTCOME NOW, and the reason is `template-approval`: that
   * word needs a MODAL rather than a line of copy, and only the caller that
   * opened the picker can own it. Every other refusal is still reported through
   * {@link AgentLaunchControls.launchError}, so nothing has two places to look.
   */
  launchAgent: (
    threadId: string | null,
    templateId?: string | null,
    overrides?: TemplateLaunchOverrides,
    /**
     * ⚠ THE FOURTH PARAM, AND IT IS FOURTH ON PURPOSE (2026-08-27). The zero- and one-argument
     * calls above stay byte-identical, which is what keeps the one-click Bot icon pinned by
     * `composer-launch.test.tsx` unchanged. Only the launch PANEL passes it.
     */
    agentId?: string
  ) => Promise<AgentLaunchOutcome>;
  /** Store a first-use approval for a FOREIGN template, machine-locally.
   *  ⚠ Feature-detected inside (`agents-controls.ts › approveTemplate`); an
   *  older main answers `no-bridge` and the modal says so. */
  approveTemplate: (templateId: string) => Promise<{ ok: boolean; reason?: string }>;
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

  const launchAgent = async (
    threadId: string | null,
    templateId?: string | null,
    overrides?: TemplateLaunchOverrides,
    agentId?: string
  ): Promise<AgentLaunchOutcome> => {
    // ⚠ A GUARDED CALL ANSWERS `busy` RATHER THAN `undefined`. The picker awaits
    // this, and a silent early return would leave a row click looking exactly
    // like a launch that succeeded and had not pushed yet — the same silence
    // `LAUNCH_REFUSALS` exists to end.
    if (!channel || launchBusy) return { ok: false, reason: "busy" };
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
      return { ok: false, reason: "no-counterparty" };
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
        // ⚠ ABSENT, NOT `null`, WHEN THERE IS NO TEMPLATE — a blank launch must
        // put the same object on the wire it always did, so the one-click path
        // stays byte-identical to a main that has never heard of templates.
        ...(templateId ? { templateId } : {}),
        ...(overrides ? { overrides } : {}),
        // ⚠ ABSENT, NOT `undefined`-valued, for the same reason `templateId` is: a launch with
        // no panel behind it must put the object it always did on the wire.
        ...(agentId ? { agentId } : {}),
      });
      // ⚠ THE APPROVAL WORD IS NOT AN ERROR LINE — see LAUNCH_APPROVAL_REASON.
      if (!res.ok && res.reason !== LAUNCH_APPROVAL_REASON) {
        setLaunchError(launchRefusalText(res.reason));
      }
      if (res.ok) refreshDesktopSessions?.();
      void refetch();
      return { ok: res.ok, reason: res.reason, template: res.template, agentId: res.agentId };
    } finally {
      setLaunchBusy(false);
    }
  };

  return {
    peerSessions,
    canLaunch: canLaunchAgents(),
    launchBusy,
    launchAgent,
    // ⚠ A THIN PASS-THROUGH ON PURPOSE. It stores nothing here and caches
    // nothing here: the approval lives in the desktop's `electron-store`, and a
    // renderer-side "already approved" memo would be exactly the fence the
    // untrusted text is in a position to influence (`agents-controls.ts ›
    // approveTemplate`).
    approveTemplate,
    launchError,
    // Wave 3: the peer projection's re-read, handed to the page's `refetchAll` so
    // peer cards ride the `channel_messages` doorbell that is already paid for
    // instead of waiting out the 30s poll (INVARIANTS §7 — no new publication).
    refetch,
  };
}
