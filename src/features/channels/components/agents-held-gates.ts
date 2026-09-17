"use client";

/**
 * WHAT THIS AGENT IS BLOCKED ON, read off the desktop's feed — the pure half of the inline
 * approval surface (Samuel, 2026-09-17: *"i dont see like a surface where I can approve the
 * permission either inline"*).
 *
 * ⚠ THE PROBLEM IT ANSWERS IS NOT "the operator was not told". They WERE: the card says
 * "Waiting on you" (`agents-model.ts › agentDetailLabel`) and an orchestrator reading over MCP
 * gets `BLOCKED on its operator's approval`. What was missing was the ANSWER — the buttons lived
 * on the v1 session window, which is deleted (F-228), and what replaced them was a native
 * notification the operator gets once, cannot return to, and loses to a ten-minute TTL.
 *
 * ⚠ IT IS READ OFF A WIDENED LOCAL TYPE RATHER THAN DECLARED ON `DesktopSessionSummary`, the
 * rule {@link import("./agents-model").agentEndedAt} and `agentRunningModel` already follow and
 * for the same reason: the bridge type is the DESKTOP's to widen, the two trees ship separately,
 * and this side must survive either version of it. **An older main omits the field, and that
 * must read as "cannot say", never as "nothing is held"** — which is exactly what it does,
 * because absent and `[]` both render no card while `detail: "permission"` still says the agent
 * is waiting on a human.
 *
 * ⚠ THE DESKTOP OWNS WHICH CALLS ARE OFFERED AND THIS SIDE ADDS NONE. `main/session-held-gates.js`
 * records only the DOCK shape; an own-channel post is answered on its own held-post card in the
 * send box, and offering it a second pair of buttons here would be two answers to one question.
 *
 * ⚠ NO HOOK, NO BRIDGE, NO REACT — the split `permission-modes.ts` follows. The command lives in
 * `agents-controls.ts`; the face lives in `agent-held-gate.tsx`. This is the projection between
 * them, so its cases can be driven without a DOM.
 */

import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";

/** One call this machine is holding at the gate, as `main/session-held-gates.js` records it. */
export interface AgentHeldGate {
  /** The id `sessions.answerPermission` answers. Opaque here — never parsed. */
  requestId: string;
  /** The tool, already shortened past its `mcp__<server>__` prefix by main. */
  tool: string;
  /** For `dopl_channel`, the `<op>.<action>` key the classifiers match on; `""` otherwise. */
  op: string;
  /** One line of the call's input — the channel, the agent, the command. May be `""`. */
  summary: string;
  /** A `main/session-gate-reason.js › GATE_REASONS` code. THE RENDERER OWNS THE COPY. */
  reason: string;
}

/** A summary from a main that may predate the field. ⚠ The widening is LOCAL on purpose. */
type MaybeHeld = DesktopSessionSummary & { heldGates?: unknown };

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * THE HELD CALLS ON THIS AGENT, or `[]`.
 *
 * ⚠ IT VALIDATES RATHER THAN CASTS, and that is not defensive dressing: the entries cross an IPC
 * boundary from a main process that ships separately, so a build with a different shape must
 * degrade to "no card" instead of rendering `undefined` beside two live buttons. An entry with no
 * `requestId` is DROPPED — it could never be answered, so a card for it is a button that can only
 * refuse, which is the inert-control failure this whole family is written against.
 */
export function agentHeldGates(session: MaybeHeld): AgentHeldGate[] {
  const raw = session?.heldGates;
  if (!Array.isArray(raw)) return [];
  const out: AgentHeldGate[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const requestId = asString(e.requestId);
    if (!requestId) continue;
    out.push({
      requestId,
      tool: asString(e.tool) || "a tool",
      op: asString(e.op),
      summary: asString(e.summary),
      reason: asString(e.reason),
    });
  }
  return out;
}

/**
 * WHAT IS BEING ASKED FOR, in one line: `<tool> · <op or input summary>`.
 *
 * ⚠ THE OP KEY BEATS THE INPUT SUMMARY when both exist, because under the five-op `dopl_channel`
 * surface the op is the thing that distinguishes a roster READ from an INVITE — the same
 * distinction F-578 added to the desktop's audit line, for the same reason. The summary is the
 * fallback for every other tool, where the input IS the question ("Bash · rm -rf …").
 * ⚠ NEITHER IS REQUIRED. A tool with no op and no summary renders as its own name, which is
 * still a real question; inventing a clause would be worse than the short one.
 */
export function heldGateTitle(gate: AgentHeldGate): string {
  const detail = gate.op || gate.summary;
  return detail ? `${gate.tool} · ${detail}` : gate.tool;
}

/**
 * WHY IT STOPPED, in plain words — the ONE place the desktop's gate REASON CODE becomes copy.
 *
 * ⚠ THE CODE IS DERIVED ON THE DESKTOP, THE PHRASE IS WRITTEN HERE, exactly as
 * `agents-model.ts › agentDetailLabel` splits `detail`. `main/session-gate-reason.js` owns
 * "which of these situations is this", because that is a fact about the gate and there must be
 * one answer to it; what a human reads is a product decision that belongs with the design tokens,
 * and shipping the sentence over IPC would make a copy change need a desktop release.
 *
 * ⚠ AN UNKNOWN CODE RENDERS NOTHING, NOT THE RAW CODE. A newer main can emit a code this build
 * has never heard of, and `container-audience` appearing verbatim under two buttons is worse than
 * the title alone — which is always true. Absent is the same answer, for the same reason.
 *
 * ⚠ THEY ARE PHRASES, NOT EXPLANATIONS (INVARIANTS §5's minimal-copy rule, Samuel). This card is
 * a label and two controls; the place that teaches the posture model is the Settings tab.
 */
const GATE_REASON_WORDS: Record<string, string> = {
  // AXIS A — the TOOL posture decided it.
  "awaiting-approval": "This agent asks first",
  "not-covered-by-bypass": "Outside its tool posture",
  "unclassified-tool": "Tool it does not know",
  // AXIS B — a MESSAGE operation, which no tool posture governs.
  "message-approval-required": "Message needs your say-so",
  "read-approval-required": "Channel read needs your say-so",
  "channel-op-approval-required": "Channel change needs your say-so",
  "cross-channel-post": "Another channel",
  "cross-channel-read": "Another channel",
  "malformed-post-fields": "Message fields it could not read",
  // The two BOUNDS that still ask rather than refuse.
  "launch-posture-required": "Launching agents needs both postures",
  "container-audience": "Another workspace",
};

export function heldGateReasonLabel(reason: string): string | null {
  return GATE_REASON_WORDS[reason] ?? null;
}
