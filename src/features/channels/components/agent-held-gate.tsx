"use client";

/**
 * Channels — THE HELD-GATE CARD: the inline surface for approving one tool call this machine is
 * blocked on (Samuel, 2026-09-17, verbatim: *"i dont see like a surface where I can approve the
 * permission either inline"*).
 *
 * ⚠ WHAT WAS MISSING WAS THE ANSWER, NOT THE NEWS. The panel already said "Waiting on you"
 * (`agents-model.ts › agentDetailLabel`) and an orchestrator reading over MCP already got
 * `BLOCKED on its operator's approval`. The BUTTONS lived on the v1 session window, deleted in
 * the 2026-08-20 retirement (F-228, INVARIANTS §11 — windowless sessions, never reintroduced),
 * and what replaced them was a native notification with an Allow action: a surface the operator
 * gets once, cannot return to, and loses to a ten-minute TTL. This is the one they can come back
 * to.
 *
 * ⚠ IT RENDERS IN THE CONTROL STRIP, NOT IN THE STREAM. The stream is a RECORD of what the agent
 * did; this is a CONTROL, and it belongs with Pause / End / Open window — the box the operator
 * already looks at when they want to act on an agent rather than read it. Mounting it in the
 * stream would also put it behind a scroll, which is the wrong place for the one thing standing
 * between the agent and its next turn.
 *
 * ⚠ **TWO HOSTS SINCE R-24 (Samuel, 2026-09-17): the panel's strip AND the agent WINDOW**
 * (`agent-panel-controls.tsx › AgentControls`, `agent-window.tsx › ChannelsAgentWindow`). An
 * operator working in the window could not answer a held call from it, and the notification is not
 * an answer path — it is got once and lost to a ten-minute TTL. ⚠ **ONLY THIS CARD CROSSED**:
 * Pause / End stay panel-only, because a destructive verb in a window that never had one is a new
 * control rather than a move. ⚠ Both hosts hand it the same `onRefreshSessions` for the same one
 * reason — a REFUSAL is not a push.
 *
 * ⚠ ONE CARD PER HELD CALL. A session can hold several (the fan-out feeds a new turn while the
 * first call waits), and they are DIFFERENT questions with different answers — a single
 * "approve everything" control would be a standing grant wearing a per-call face, which is
 * exactly the power `main/session-answer-permission.js` refuses to mint.
 *
 * ⚠ LABEL + CONTROL, NO EXPLAINER (Samuel's minimal-copy ruling, INVARIANTS §5). What is being
 * asked, why it stopped in a few words, two buttons. The place that teaches the posture model is
 * the Settings tab; a paragraph here would be read once and skipped forever after.
 *
 * ⚠ NO NEW COLOURS AND NO NEW RECIPES. Approve wears `.auth-btn-3d` (the raised black primary
 * CTA) and Deny `.btn-light` (the small raised light button) — the two kit faces
 * `agent-panel-controls.tsx › ControlButton` and `agent-stream-escalation.tsx` already compose,
 * at this file's own geometry. Every colour is a token.
 */

import { useState } from "react";
import { cn } from "@/shared/lib/utils";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import {
  agentHeldGates,
  heldGateReasonLabel,
  heldGateTitle,
  type AgentHeldGate,
} from "./agents-held-gates";
import {
  answerAgentPermission,
  canAnswerPermission,
} from "./agents-gate-controls";

/**
 * What a refused answer says.
 *
 * ⚠ IT IS ONE SENTENCE FOR EVERY REFUSAL REASON, DELIBERATELY. `unknown-request`,
 * `already-decided` and `no-session` differ only in HOW the request stopped being answerable,
 * and the operator's next action is identical in all three: nothing, the card is about to
 * disappear. Wording them apart would spend three lines of copy teaching a distinction with no
 * consequence — and the one thing that must not happen, an answer silently doing nothing, is
 * what this line exists to prevent (`AGENT_CONTROL_REFUSED`'s own argument, next door).
 * ⚠ Exported for the test: a swallowed refusal and a real answer are indistinguishable on
 * screen, which is the whole failure.
 */
export const HELD_GATE_REFUSED = "This request is no longer waiting.";

/**
 * EVERY HELD CALL ON THIS AGENT, one card each — or nothing.
 *
 * ⚠ NOTHING IS THE ANSWER IN THREE DIFFERENT CASES and they must all render identically: the
 * agent holds nothing, this main does not report held calls, or this build cannot answer one.
 * The pill still says the agent is waiting on a human in the second and third, which is honest;
 * a card that could only refuse would not be.
 */
export function AgentHeldGates({
  agent,
  onRefreshSessions,
  className,
}: {
  agent: DesktopSessionSummary;
  /** Re-read the desktop's feed after a refusal — a refusal is not a push, so nothing else
   *  will arrive to correct a card standing over a request that is already gone. */
  onRefreshSessions?: () => void;
  className?: string;
}) {
  const gates = agentHeldGates(agent);
  // ⚠ THE CAPABILITY IS CHECKED ON THE BRIDGE MEMBER, at the call site, not on the wrapper
  // (INVARIANTS §11). A web build with no bridge renders nothing at all.
  if (!gates.length || !canAnswerPermission()) return null;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {gates.map((gate) => (
        <HeldGateCard
          key={gate.requestId}
          agent={agent}
          gate={gate}
          onRefreshSessions={onRefreshSessions}
        />
      ))}
    </div>
  );
}

function HeldGateCard({
  agent,
  gate,
  onRefreshSessions,
}: {
  agent: DesktopSessionSummary;
  gate: AgentHeldGate;
  onRefreshSessions?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const why = heldGateReasonLabel(gate.reason);

  const answer = (allow: boolean) => {
    setBusy(true);
    setNotice(null);
    // ⚠ NO OPTIMISTIC REMOVAL. The card goes when MAIN's next push stops listing the request;
    // hiding it on click would hide the one case worth seeing — an answer nothing took.
    void answerAgentPermission({
      channelId: agent.channelId,
      taskId: agent.taskId,
      agentId: agent.agentId,
      requestId: gate.requestId,
      allow,
    })
      .then((res) => {
        if (res.ok) return;
        setNotice(HELD_GATE_REFUSED);
        onRefreshSessions?.();
      })
      .finally(() => setBusy(false));
  };

  return (
    <div
      data-agent-held-gate={gate.requestId}
      className="flex flex-col gap-1.5 rounded-[10px] border border-border-default px-2 py-1.5"
    >
      {/* ⚠ `wrap-anywhere` AND NOT `truncate`: the operator is deciding on this string, and a
          command clipped mid-path is a decision made on half the question. The desktop already
          bounds it to one short line (`main/session-held-gates.js › SUMMARY_CAP`). */}
      <span className="wrap-anywhere text-caption font-medium text-text-primary">
        {heldGateTitle(gate)}
      </span>
      {why && <span className="text-micro text-text-muted">{why}</span>}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => answer(true)}
          className={cn(
            "auth-btn-3d rounded-full px-2.5 py-1 text-caption font-medium text-text-on-cta",
            "disabled:cursor-not-allowed disabled:opacity-60"
          )}
        >
          Approve
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => answer(false)}
          className={cn(
            "btn-light rounded-full px-2.5 py-1 text-caption font-medium text-text-primary",
            "disabled:cursor-not-allowed disabled:text-text-disabled"
          )}
        >
          Deny
        </button>
      </div>
      {notice && (
        <p role="status" className="text-caption text-text-muted">
          {notice}
        </p>
      )}
    </div>
  );
}
