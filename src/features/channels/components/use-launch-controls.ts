"use client";

/** The one launch act for every surface: payload, in-flight guard, refusal copy (INVARIANTS §5A). */

import { useRef, useState } from "react";
import type { IdentityLaunchOverrides } from "@/features/agent-identities/lib/launch-overrides";
import { useChannelLaunchPosture } from "../hooks/use-channel-launch-posture";
import type { RuntimeDescriptor } from "../lib/runtime-capability";
import { noRuntimeCopy, signedOutLaunchCopy } from "../lib/runtime-copy";
import type { AgentColorKey } from "../types";
import { approveIdentity, canLaunchAgents, launchAgentOnThread } from "./agents-controls";

/** One short line per refusal word main answers, plus the bridge's `no-bridge`. */
const LAUNCH_REFUSALS: Record<string, string> = {
  "no-bridge": "Not available here",
  busy: "Busy right now — try again",
  cap: "Session limit reached",
  // The spawn was rolled back on the way up — not a settings state.
  disabled: "The agent could not be started",
  // Deleted or invisible: the resolve is 404-never-403.
  "no-identity": "That identity is gone — reload the list",
  "no-model": "That model is not offered on this machine — pick another",
};

/** A question, not a refusal: first launch of a foreign identity here. Never an error line. */
export const LAUNCH_APPROVAL_REASON = "identity-approval";

/** Copy built from the LAUNCHED runtime's descriptor, so it names the runtime that refused. */
const RUNTIME_REFUSALS: Record<string, (d: RuntimeDescriptor | null | undefined) => string> = {
  "no-sdk": noRuntimeCopy,
  "auth-hold": signedOutLaunchCopy,
};

/** One refusal word → the line the operator reads. */
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
  /** The address main created — never an echo of a pre-assigned id. */
  agentId?: string;
  /** Rides {@link LAUNCH_APPROVAL_REASON} only. Read tolerantly. */
  identity?: { name?: string | null; instructions?: string | null } | null;
}

/** `threadId: null` = a channel-level agent. Every later argument absent = "no pick". */
export type LaunchAgentCall = (
  threadId: string | null,
  identityId?: string | null,
  overrides?: IdentityLaunchOverrides,
  agentId?: string,
  runtime?: string,
  color?: AgentColorKey
) => Promise<AgentLaunchOutcome>;

declare const WHOLE_LAUNCH: unique symbol;

/** Branded so a narrower wrapper prop (dropping agent id/runtime/colour) stops compiling (P6-01). */
export type LaunchAgentFn = LaunchAgentCall & { readonly [WHOLE_LAUNCH]: true };

/** Mark a function as the whole launch act. For {@link useLaunchControls} and test doubles only. */
export const wholeLaunch = (fn: LaunchAgentCall): LaunchAgentFn => fn as LaunchAgentFn;

export interface AgentLaunchControls {
  /** The bridge op exists on this build. Absent ⇒ offer no control at all. */
  canLaunch: boolean;
  launchBusy: boolean;
  /** The last refusal's copy, or `null`. */
  launchError: string | null;
  /** Returns `identity-approval` for the caller's modal; other refusals land in `launchError`. */
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
 * Absent keys are OMITTED, never `null`/`undefined`, so an untouched dialog equals a one-click
 * launch; never `runtime: ''` (on the settings wire `''` is a clear). The counterparty only labels.
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
 * The in-flight guard is a ref, so a double click inside one render starts one agent. Refusal copy
 * names the LAUNCHED runtime (the per-spawn pick, else the channel's).
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
    // Pass-through: a renderer memo would be a fence untrusted identity text could influence.
    approveIdentity,
  };
}
