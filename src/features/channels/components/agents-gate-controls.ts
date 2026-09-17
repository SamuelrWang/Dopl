"use client";

/**
 * ANSWERING A HELD GATE — the operator approving or denying ONE tool call their own machine is
 * holding (Samuel, 2026-09-17: *"i dont see like a surface where I can approve the permission
 * either inline"*).
 *
 * ⚠ IT IS A SIBLING OF `agents-controls.ts` AND FOLLOWS EVERY RULE IN THAT FILE'S HEADER —
 * feature-detect the BRIDGE MEMBER at the call site (never a wrapper exported from here, which
 * is always a function and would render a control that can only refuse); return main's verdict
 * and never swallow it; own agents only, structurally, because main resolves against its own
 * registry; and `agentId` names the INSTANCE, because a card drawn from one agent's row must not
 * answer the oldest live agent's question instead.
 *
 * ⚠ IT IS A SEPARATE FILE ONLY BECAUSE `agents-controls.ts` STOOD AT EXACTLY THE 500-LINE §1 CAP
 * (`wc -l` it — the number is measured, not remembered). That is a line budget and not a
 * reason-to-change seam, which is said plainly rather than dressed up as an architecture: these
 * two exports belong with the other commands and would move back the day that file has room.
 * Nothing imports this through `agents-controls.ts`, because a re-export line there is a line
 * that file does not have either.
 */

import { getSpaBridge } from "@/shared/lib/spa-bridge";

/**
 * Whether this build can ANSWER a held tool call at all.
 *
 * ⚠ IT DETECTS `sessions.answerPermission`, THE OP IT IS ABOUT TO USE — the strict form of the
 * rule `agents-controls.ts › canMessageAgent` carries the bug for. ⚠ DO NOT WIDEN IT to
 * `sessions.summaries`, `canControlAgents`, or `window.dopl` being truthy: a main that reports
 * the feed and cannot answer a gate is precisely the build shape this gate exists for, and
 * widening it renders Approve / Deny on every desktop older than the op. The card must be ABSENT
 * there rather than inert — the operator is already stuck, and a dead Approve button tells them
 * the feature is broken instead of missing.
 */
export function canAnswerPermission(): boolean {
  return typeof getSpaBridge()?.sessions?.answerPermission === "function";
}

/**
 * APPROVE OR DENY ONE HELD TOOL CALL.
 *
 * ⚠ IT ANSWERS A QUESTION; IT DOES NOT DECIDE ONE. The gate already ruled "hold and ask"
 * (`main/session-gate-bridge.js › gateCall`); this carries the operator's answer to a resolver
 * already parked in main. It grants nothing standing — main resolves ALLOW-ONCE, so the next
 * call of the same shape asks again — moves neither permission axis, starts no turn, and cannot
 * make a call succeed that the tool PROFILE refused, because a `deny` verdict parks no resolver
 * for anyone to answer.
 *
 * ⚠ NOTHING IS STAMPED OPTIMISTICALLY. The card goes away because MAIN's next state push no
 * longer lists the request (`DesktopSessionSummary.heldGates`) — the render-main's-value rule
 * `setAgentMode` and `setAgentModel` already follow. A card that vanished on click would hide
 * exactly the case worth seeing: an answer that nothing took.
 *
 * ⚠ `{ ok: false }` IS AN ORDINARY OUTCOME HERE, NOT A RARE ERROR, which is why the reason is
 * returned rather than swallowed: `unknown-request` (answered elsewhere, or expired against
 * main's ten-minute gate TTL), `already-decided` (a park fail-closed the resolver between the
 * push this card was drawn from and the click), `no-session`, `no-bridge`. An operator who
 * believes they approved something that was in fact denied is this lane's worst outcome.
 */
export async function answerAgentPermission(payload: {
  channelId: string;
  taskId: string;
  /** WHICH instance — `agents-controls.ts`'s header carries the rule. */
  agentId?: string;
  requestId: string;
  allow: boolean;
}): Promise<{ ok: boolean; reason?: string }> {
  const sessions = getSpaBridge()?.sessions;
  if (typeof sessions?.answerPermission !== "function") {
    return { ok: false, reason: "no-bridge" };
  }
  const res = await sessions.answerPermission(
    payload.channelId,
    payload.taskId,
    payload.requestId,
    payload.allow,
    payload.agentId
  );
  return { ok: res?.ok === true, reason: res?.reason };
}
