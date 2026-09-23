"use client";

/**
 * Commands on the operator's own agents (main resolves its own registry); callers never swallow the
 * verdict. Feature-detect the BRIDGE member, never the exported wrapper (always a function → true in
 * a browser). Always pass `agentId`: without it main acts on the OLDEST live agent on the thread.
 */

import { useCallback } from "react";
import { getSpaBridge } from "@/shared/lib/spa-bridge";
import type { IdentityLaunchOverrides } from "@/features/agent-identities/lib/launch-overrides";
import type { AgentColorKey } from "../types";

/** Gates the stop verbs only; `reopen` is detected separately ({@link canOpenAgentWindow}). */
export function canControlAgents(): boolean {
  const sessions = getSpaBridge()?.sessions;
  return (
    typeof sessions?.pause === "function" && typeof sessions?.end === "function"
  );
}

/** Either op counts: the older `reopen` hands a windowless session to the same window. */
export function canOpenAgentWindow(): boolean {
  const sessions = getSpaBridge()?.sessions;
  return (
    typeof sessions?.openAgentWindow === "function" ||
    typeof sessions?.reopen === "function"
  );
}

export function canMessageAgent(): boolean {
  return typeof getSpaBridge()?.sessions?.message === "function";
}

export function canSetAgentMode(): boolean {
  return typeof getSpaBridge()?.sessions?.setMode === "function";
}

/**
 * Moves ONE running session's posture from its next gate decision (`session-io.js › grantArgs`
 * reads it at call time) — not the channel's launch posture. Supervision, not containment: the
 * tool profile is checked first and no posture widens it.
 */
export async function setAgentMode(payload: {
  channelId: string;
  taskId: string;
  agentId?: string;
  axis: "tools" | "messages";
  mode: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const sessions = getSpaBridge()?.sessions;
  if (typeof sessions?.setMode !== "function") return { ok: false, reason: "no-bridge" };
  const res = await sessions.setMode(
    payload.channelId,
    payload.taskId,
    payload.axis,
    payload.mode,
    payload.agentId
  );
  return { ok: res?.ok === true, reason: res?.reason };
}

/** Detects `sessions.setModel` — not `setMode`, which exists on builds predating the model op. */
export function canSetAgentModel(): boolean {
  return typeof getSpaBridge()?.sessions?.setModel === "function";
}

/** Promises no timing: the confirmation is the feed (`DesktopSessionSummary.model`). */
export async function setAgentModel(payload: {
  channelId: string;
  taskId: string;
  agentId?: string;
  /** A model id, or `""` (`AGENT_MODEL_DEFAULT`) for the runtime's default. */
  model: string;
}): Promise<{ ok: boolean; reason?: string; detail?: string }> {
  const sessions = getSpaBridge()?.sessions;
  if (typeof sessions?.setModel !== "function") {
    return { ok: false, reason: "no-bridge" };
  }
  const res = await sessions.setModel(
    payload.channelId,
    payload.taskId,
    payload.model,
    payload.agentId
  );
  return { ok: res?.ok === true, reason: res?.reason, detail: res?.detail };
}

/** The one op here that starts a turn; main owns its security shape
 *  (`session-reopen.js › messageByTask`). */
export async function messageAgent(payload: {
  channelId: string;
  taskId: string;
  agentId?: string;
  text: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const sessions = getSpaBridge()?.sessions;
  if (typeof sessions?.message !== "function") return { ok: false, reason: "no-bridge" };
  const res = await sessions.message(
    payload.channelId,
    payload.taskId,
    payload.text,
    payload.agentId
  );
  return { ok: res?.ok === true, reason: res?.reason };
}

export function canLaunchAgents(): boolean {
  return typeof getSpaBridge()?.sessions?.launch === "function";
}

/**
 * Every call spawns a fresh instance (the cap is main's). Two success shapes: an `agentId` in the
 * reply ⇒ success. `identityId` is an id, never a snapshot: main resolves it at spawn, so renderer
 * text never lands in a prompt.
 */
export async function launchAgentOnThread(payload: {
  channelId: string;
  /** `null` = a channel-level agent — not `''`, a responder thread that never became first-class. */
  taskId: string | null;
  workspaceId: string;
  channelName: string;
  threadTitle: string | null;
  /** The thread's other party, when known — a label on the outbound card, never a fence. */
  counterpartyId?: string | null;
  /** Absent reads `false` in main. */
  direct?: boolean;
  /** The identity to wear, or `null`/absent for a BLANK agent. */
  identityId?: string | null;
  /** Pre-assigned via `sessions.mintAgentId`; accepted, not trusted (main re-checks it). */
  agentId?: string;
  /** Ephemeral re-points, re-validated by main. Absent ⇒ the identity's own values. */
  overrides?: IdentityLaunchOverrides;
  /**
   * Top-level: a session property, not an identity re-point. Absent ⇒ identity's → channel's →
   * default; a pick this Mac cannot run is refused `no-sdk`
   * (`launch-default.js › resolveLaunchRuntime`). Widens nothing: no tool profile on a payload.
   */
  runtime?: string;
  /** Top-level, not `overrides` (unique per channel). Absent = the server picks the first free
   *  key. Main re-narrows it (`session-launch-op.js › colorKey`). */
  color?: AgentColorKey;
}): Promise<{
  ok: boolean;
  agentId?: string;
  reason?: string;
  /** Main's own `no-model` sentence. */
  detail?: string;
  identity?: { name?: string | null; instructions?: string | null } | null;
}> {
  const sessions = getSpaBridge()?.sessions;
  if (typeof sessions?.launch !== "function") return { ok: false, reason: "no-bridge" };
  const res = await sessions.launch(payload);
  const agentId = typeof res?.agentId === "string" && res.agentId ? res.agentId : undefined;
  return {
    ok: res?.ok === true || agentId !== undefined,
    agentId,
    reason: res?.reason,
    detail: res?.detail,
    identity: res?.identity ?? null,
  };
}

/**
 * Machine-local by design (no route, MCP op or column): a server-stored flag could be
 * self-approved by an agent holding the operator's token.
 */
export async function approveIdentity(
  identityId: string
): Promise<{ ok: boolean; reason?: string }> {
  const sessions = getSpaBridge()?.sessions;
  if (typeof sessions?.approveIdentity !== "function") {
    return { ok: false, reason: "no-bridge" };
  }
  const res = await sessions.approveIdentity(identityId);
  return { ok: res?.ok === true, reason: res?.reason };
}

export type AgentControl = "pause" | "end";

/** Own agents only (main's own registry); `end` ends the agent, never a thread (INVARIANTS §5). */
export function useAgentControls() {
  return useCallback(
    async (
      control: AgentControl,
      session: { channelId: string; taskId: string; agentId?: string }
    ): Promise<boolean> => {
      const sessions = getSpaBridge()?.sessions;
      const op = control === "pause" ? sessions?.pause : sessions?.end;
      if (typeof op !== "function") return false;
      const result = await op(session.channelId, session.taskId, session.agentId);
      return result?.ok === true;
    },
    []
  );
}

/**
 * Opens the agent view: `openAgentWindow`, else the older `reopen` (same window). `segment` is the
 * workspace route segment main cannot derive; main re-checks it.
 */
export async function openAgentWindow(
  session: { channelId: string; taskId: string; agentId?: string },
  segment: string
): Promise<{ ok: boolean; reason?: string }> {
  const sessions = getSpaBridge()?.sessions;
  if (typeof sessions?.openAgentWindow === "function") {
    const res = await sessions.openAgentWindow(
      segment,
      session.channelId,
      session.taskId,
      session.agentId
    );
    return { ok: res?.ok === true, reason: res?.reason };
  }
  // Same detection as the gate that hides the button.
  if (typeof sessions?.reopen !== "function") return { ok: false, reason: "no-bridge" };
  const res = await sessions.reopen(
    session.channelId,
    session.taskId,
    segment,
    session.agentId
  );
  return { ok: res?.ok === true, reason: res?.reason };
}
