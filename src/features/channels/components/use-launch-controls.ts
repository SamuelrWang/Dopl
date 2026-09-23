"use client";

/**
 * THE ONE LAUNCH ACT — the payload, the in-flight guard, and the refusal copy — shared by every
 * surface that starts an agent: the channel page's Agents tab and composer (through
 * `use-agents-panel.ts`) and the agent pop-out's `+` (`agent-window-launch.tsx`). INVARIANTS §5A:
 * one launch lane, so one builder of its payload and one reader of its refusals.
 */

import { useRef, useState } from "react";
import type { IdentityLaunchOverrides } from "@/features/agent-identities/lib/launch-overrides";
import { useChannelLaunchPosture } from "../hooks/use-channel-launch-posture";
import type { RuntimeDescriptor } from "../lib/runtime-capability";
import { noRuntimeCopy, signedOutLaunchCopy } from "../lib/runtime-copy";
import type { AgentColorKey } from "../types";
import { approveIdentity, canLaunchAgents, launchAgentOnThread } from "./agents-controls";

/**
 * One short line per refusal `sessions:launch` answers (minimal copy, INVARIANTS §5). The keys are
 * main's words (`session-launch-op.js`, `session-engine.js › launch`) plus the bridge's own
 * `no-bridge`; an unknown word falls back rather than rendering a raw enum.
 */
const LAUNCH_REFUSALS: Record<string, string> = {
  "no-bridge": "Not available here",
  // Every click mints a new agent; `busy` is main momentarily unable to start one.
  busy: "Busy right now — try again",
  cap: "Session limit reached",
  // The `attachSurface` rollback — the spawn was refused on the way up. Not a settings state.
  disabled: "The agent could not be started",
  // Deleted or invisible — the resolve is 404-never-403, so the copy cannot tell them apart.
  "no-identity": "That identity is gone — reload the list",
  "no-model": "That model is not offered on this machine — pick another",
};

/**
 * ⚠ NOT A REFUSAL — A QUESTION. Main answers it for the first launch of another member's identity
 * on this machine, with `{ identity: { name, instructions } }` for the approval modal
 * (`agent-identities/components/identity-approval.tsx`). It never becomes an error line.
 */
export const LAUNCH_APPROVAL_REASON = "identity-approval";

/** The two runtime-owned refusals, built from the LAUNCHED runtime's descriptor so the copy names
 *  the runtime that refused (`runtime-copy.ts`). */
const RUNTIME_REFUSALS: Record<string, (d: RuntimeDescriptor | null | undefined) => string> = {
  "no-sdk": noRuntimeCopy,
  "auth-hold": signedOutLaunchCopy,
};

/** One refusal word -> the line the operator reads. No descriptor names no vendor. */
export function launchRefusalText(
  reason: string | undefined,
  descriptor?: RuntimeDescriptor | null
): string {
  if (reason && RUNTIME_REFUSALS[reason]) return RUNTIME_REFUSALS[reason](descriptor);
  return (reason && LAUNCH_REFUSALS[reason]) || "Could not start the agent";
}

export interface AgentLaunchOutcome {
  ok: boolean;
  reason?: string;
  /** The address MAIN created — its answer, never an echo of a pre-assigned id. */
  agentId?: string;
  /** Rides {@link LAUNCH_APPROVAL_REASON} only. Read tolerantly. */
  identity?: { name?: string | null; instructions?: string | null } | null;
}

/**
 * Start an agent. `null` is a CHANNEL-LEVEL agent; a thread id starts one on that thread.
 *
 * ⚠ EVERY ARGUMENT AFTER THE FIRST IS OPTIONAL AND ABSENT MEANS "NO PICK": no identity is a blank
 * agent, no runtime is the channel's pick, no colour is the server's first free key. So the
 * one-argument call and an untouched dialog put the same payload on the wire.
 */
export type LaunchAgentCall = (
  threadId: string | null,
  identityId?: string | null,
  overrides?: IdentityLaunchOverrides,
  agentId?: string,
  runtime?: string,
  color?: AgentColorKey
) => Promise<AgentLaunchOutcome>;

declare const WHOLE_LAUNCH: unique symbol;

/**
 * THE LAUNCH ACT EXACTLY AS {@link useLaunchControls} BUILT IT (P6-01). Branded because TypeScript
 * accepts a function with FEWER parameters wherever a wider one is expected: a hand-written
 * `(id, identityId, overrides) => …` wrapper on a prop compiled and silently dropped the agent id,
 * runtime and colour. A prop typed with this refuses any wrapper.
 */
export type LaunchAgentFn = LaunchAgentCall & { readonly [WHOLE_LAUNCH]: true };

/** Mark a function as the whole launch act. For {@link useLaunchControls} and test doubles only. */
export const wholeLaunch = (fn: LaunchAgentCall): LaunchAgentFn => fn as LaunchAgentFn;

export interface AgentLaunchControls {
  /** The bridge op exists on this build. Absent ⇒ offer no control at all. */
  canLaunch: boolean;
  launchBusy: boolean;
  /** The last refusal's copy, or null. A refusal is not a push, so the launching surface is the
   *  only place it can be said. */
  launchError: string | null;
  /** Answers `identity-approval` for the caller to raise the modal; every other refusal is in
   *  {@link launchError}. */
  launchAgent: LaunchAgentCall;
  /** Store a machine-local first-use approval for a FOREIGN identity. */
  approveIdentity: (identityId: string) => Promise<{ ok: boolean; reason?: string }>;
}

/** Where a launch lands, as far as its host can say. */
export interface LaunchSite {
  channelId: string;
  workspaceId: string;
  channelName: string;
  /** Absent where the host reads no channel record (the pop-out); main then reads `false`. */
  direct?: boolean;
  /** A thread's title and OTHER party, or `null` when this host cannot resolve it. */
  thread: (threadId: string) => { title: string | null; counterpartyId: string | null } | null;
}

/**
 * THE `sessions.launch` PAYLOAD (P6-10).
 *
 * ⚠ ABSENT KEYS ARE OMITTED, NEVER `null`/`undefined`: an untouched dialog and a one-click launch
 * must be one request, and `runtime: ''` further down the wire clears a durable pick. A
 * counterparty is sent only when known — it labels the outbound card and fences nothing
 * (`session-launch-op.js`).
 */
export function buildLaunchPayload(
  site: LaunchSite,
  ...[threadId, identityId, overrides, agentId, runtime, color]: Parameters<LaunchAgentCall>
): Parameters<typeof launchAgentOnThread>[0] {
  const thread = threadId ? site.thread(threadId) : null;
  return {
    channelId: site.channelId,
    taskId: threadId,
    workspaceId: site.workspaceId,
    channelName: site.channelName,
    threadTitle: thread?.title ?? null,
    ...(thread?.counterpartyId ? { counterpartyId: thread.counterpartyId } : {}),
    ...(site.direct !== undefined ? { direct: site.direct } : {}),
    ...(identityId ? { identityId } : {}),
    ...(overrides ? { overrides } : {}),
    ...(agentId ? { agentId } : {}),
    ...(runtime ? { runtime } : {}),
    ...(color ? { color } : {}),
  };
}

/**
 * THE LAUNCH CONTROLS FOR ONE SITE — busy, refusal copy, the act and the approval pass-through.
 *
 * ⚠ ONE LAUNCH IN FLIGHT, NOT ONE AGENT PER THREAD: the guard is a ref, so a double click inside
 * one render still starts one agent (P6-02), and a guarded call answers `busy` rather than
 * `undefined`.
 * ⚠ THE REFUSAL COPY NAMES THE RUNTIME THAT WAS LAUNCHED — the per-spawn pick when there is one,
 * else the channel's (P6-03).
 */
export function useLaunchControls(
  site: LaunchSite | null,
  onSettled?: (outcome: AgentLaunchOutcome) => void
): AgentLaunchControls & { launchAgent: LaunchAgentFn } {
  const posture = useChannelLaunchPosture(site?.channelId ?? "");
  const [launchBusy, setLaunchBusy] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const launchAgent = wholeLaunch(async (threadId, identityId, overrides, agentId, runtime, color) => {
    if (!site || inFlight.current) return { ok: false, reason: "busy" };
    inFlight.current = true;
    setLaunchBusy(true);
    setLaunchError(null);
    try {
      const res = await launchAgentOnThread(
        buildLaunchPayload(site, threadId, identityId, overrides, agentId, runtime, color)
      );
      if (!res.ok && res.reason !== LAUNCH_APPROVAL_REASON) {
        const descriptor = runtime ? posture.descriptorOf(runtime) : posture.descriptor;
        setLaunchError(
          res.reason === "no-model" && res.detail
            ? res.detail
            : launchRefusalText(res.reason, descriptor)
        );
      }
      const outcome = { ok: res.ok, reason: res.reason, identity: res.identity, agentId: res.agentId };
      onSettled?.(outcome);
      return outcome;
    } finally {
      inFlight.current = false;
      setLaunchBusy(false);
    }
  });

  return {
    canLaunch: canLaunchAgents(),
    launchBusy,
    launchError,
    launchAgent,
    // ⚠ A THIN PASS-THROUGH: the approval lives in the desktop's `electron-store`, and a renderer
    // memo would be a fence the untrusted identity text could influence.
    approveIdentity,
  };
}
