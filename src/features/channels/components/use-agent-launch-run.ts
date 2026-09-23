"use client";

/**
 * Running a New Agent launch: overrides, spawn → rename → describe, and the foreign-identity
 * approval relaunch. The act itself is `use-launch-controls.ts › useLaunchControls`.
 */

import { useState } from "react";
import type { IdentityApprovalRequest } from "@/features/agent-identities/components/identity-approval";
import { NEW_AGENT_NAME } from "@/shared/lib/agent-name";
import {
  MAX_OVERRIDE_INSTRUCTIONS_CHARS,
  type IdentityLaunchOverrides,
} from "@/features/agent-identities/lib/launch-overrides";
import { AGENT_MODEL_DEFAULT } from "../lib/agent-models";
import {
  LAUNCH_APPROVAL_REASON,
  launchRefusalText,
  type AgentLaunchControls,
} from "./use-launch-controls";
import {
  describeAgent,
  renameAgent,
  type AgentLaunchPanel,
} from "./use-agent-launch";

/**
 * The model pick and rewritten instructions, or `undefined` when nothing changed so the payload
 * equals a one-click launch. Instructions compare to the identity baseline, not to empty.
 */
export function launchOverridesOf(
  panel: AgentLaunchPanel
): IdentityLaunchOverrides | undefined {
  const overrides: IdentityLaunchOverrides = {};
  if (panel.model !== AGENT_MODEL_DEFAULT) overrides.model = panel.model;
  const typed = (panel.instructions ?? "").trim();
  if (typed !== (panel.instructionsBaseline ?? "").trim()) {
    // Bounded at the column's limit to keep a pathological paste off the IPC wire; main re-bounds.
    overrides.instructions = typed.slice(0, MAX_OVERRIDE_INSTRUCTIONS_CHARS);
  }
  return overrides.model === undefined && overrides.instructions === undefined
    ? undefined
    : overrides;
}

/**
 * Spawn → rename → describe, keyed by main's returned `agentId` (fallback: the pre-assigned id).
 * A failed rename/describe never fails the launch — it is reported as `identityRefused`.
 */
export async function launchWithIdentity(
  newAgent: AgentLaunchControls,
  panel: AgentLaunchPanel,
  threadId: string | null,
  /** The dialog's selected runtime; `''` sends none. */
  runtime: string = panel.runtime
): Promise<{
  ok: boolean;
  reason?: string;
  /** Rides `identity-approval` only, forwarded from main untouched. */
  identity?: { name?: string | null; instructions?: string | null } | null;
  agentId: string | null;
  identityRefused: boolean;
}> {
  const outcome = await newAgent.launchAgent(
    threadId,
    panel.identityId,
    launchOverridesOf(panel),
    panel.agentId ?? undefined,
    runtime || undefined,
    // `undefined` when no circle was touched: the server assigns the first free key.
    panel.color ?? undefined
  );
  if (!outcome.ok) {
    return {
      ok: false,
      reason: outcome.reason,
      identity: outcome.identity,
      agentId: null,
      identityRefused: false,
    };
  }
  const address = outcome.agentId ?? panel.agentId;
  if (!address) {
    // Started, but no address to key metadata to — still a success.
    return { ok: true, agentId: null, identityRefused: false };
  }
  // A blank name is STORED as `New Agent` (a stored name claims the handle namespace); a rename
  // refusal is reported only for a typed name — older builds lack `sessions.rename`.
  const typed = panel.name.trim();
  const named = await renameAgent(address, typed || NEW_AGENT_NAME);
  const described = panel.description.trim() === ""
    ? true
    : await describeAgent(address, panel.description.trim());
  return { ok: true, agentId: address, identityRefused: (typed !== "" && !named) || !described };
}

/** The dialog's launch runner; an approval relaunches through {@link launchWithIdentity} whole. */
export function useLaunchRunner({
  newAgent,
  panel,
  openThreadId,
  runtime,
}: {
  newAgent?: AgentLaunchControls;
  panel: AgentLaunchPanel;
  openThreadId: string | null;
  runtime: string;
}) {
  const [approval, setApproval] = useState<IdentityApprovalRequest | null>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);

  const run = async () => {
    if (!newAgent) return;
    const res = await launchWithIdentity(newAgent, panel, openThreadId, runtime);
    if (res.reason === LAUNCH_APPROVAL_REASON && panel.identityId) {
      // Main's own resolved text; instructions get no local fallback — the question is about them.
      setApproval({
        identityId: panel.identityId,
        name: res.identity?.name ?? "this identity",
        instructions: res.identity?.instructions ?? null,
      });
      return;
    }
    if (!res.ok) return; // every other refusal is already said by `newAgent.launchError`
    if (res.identityRefused) {
      // The agent is running: the panel stays open holding the report.
      panel.setIdentityError("The agent started, but its name or description was not saved.");
      return;
    }
    panel.reset();
  };

  return {
    approval,
    /** Why storing the approval failed; the modal stays open holding it. */
    approvalError,
    launch: () => void run(),
    cancelApproval: () => {
      setApproval(null);
      setApprovalError(null);
    },
    confirmApproval: () => {
      const identityId = approval?.identityId;
      if (!identityId || !newAgent) return;
      setApprovalError(null);
      void newAgent.approveIdentity(identityId).then(
        (res) => {
          if (!res.ok) {
            setApprovalError(launchRefusalText(res.reason));
            return;
          }
          setApproval(null);
          void run();
        },
        () => setApprovalError(launchRefusalText(undefined))
      );
    },
  };
}
