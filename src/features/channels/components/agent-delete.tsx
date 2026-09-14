"use client";

/**
 * DELETE ONE AGENT, FROM ITS CARD (2026-08-25, Samuel's ruling). A trash icon that appears on
 * hover, LEFT of the card's Open button, and one small confirmation.
 *
 * ⚠ THE CONTROL AND ITS CAPABILITY LIVE TOGETHER, HERE, and not in `agents-controls.ts`. That
 * module is the imperative half of the agents family and it sits at 465 lines — §1's rule for a
 * file one edit from the cap is to split rather than to shave a comment off it, and this is a
 * real seam either way: everything in `agents-controls.ts` moves a LIVE session (pause, end,
 * steer, posture, model), while this one DESTROYS a record. `agent-rename.tsx` is the precedent
 * — it holds its own bridge call for the same reason.
 *
 * ⚠ **DELETION IS LOCAL. THE CHANNEL RECORD IS IMMUTABLE BY IT.** Every message this agent
 * posted stays in the transcript, attributed exactly as it was: the id rides the MESSAGE
 * (`agents-model.ts › parseAgentPostStamp`, off `client_msg_id`), so a deleted agent's rows keep
 * reading `Agent #<id>` with no local table involved. What goes is this machine's own view of
 * the run — the work history, the retained card, the display name, any window onto it.
 *
 * ⚠ THE DISPLAY NAME GOES WITH IT (Samuel: *"all information attached"*). A renamed agent's
 * transcript rows fall back to the canonical `Agent #<id>`, which is what an agent that was
 * never renamed has always rendered as. The identity survives; the label does not.
 *
 * ⚠ ONE CONFIRM, NEVER TWO. A LIVE agent is ENDED by the same call that deletes it (main runs
 * the one stop path first), so the running case adds a CLAUSE to this dialog rather than a
 * second question — asking twice for one gesture is how an operator learns to click through
 * confirmations.
 *
 * ⚠ DESKTOP-ONLY, FEATURE-DETECTED ON THE BRIDGE OP. With no bridge (a plain browser) or an
 * older main with no handler there is no trash icon at all — detect the op you are about to
 * USE, never a wrapper exported from this module, which is always a function
 * (`agents-controls.ts › canMessageAgent` carries the bug that earned the rule).
 */

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { getSpaBridge } from "@/shared/lib/spa-bridge";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { IconButton } from "./icon-button";
import { agentDisplayName } from "./agents-model";

/**
 * Whether this build can delete an agent at all.
 * ⚠ IT DETECTS `sessions.delete`, THE OP IT IS ABOUT TO USE — an older main ships a `sessions`
 * object without the member and the type cannot know which main is on the other side
 * (INVARIANTS §11). A control that can only refuse is worse than an absent one.
 */
export function canDeleteAgent(): boolean {
  return typeof getSpaBridge()?.sessions?.delete === "function";
}

/**
 * THE ONE LINE THE DIALOG SAYS, in two cases and no more.
 *
 * ⚠ THE RUNNING CLAUSE IS A FACT ABOUT WHAT THIS CLICK WILL DO, not a warning: an operator
 * deleting a card they can see is idle should not be told anything about stopping. Pure and
 * exported so the wording is testable without a DOM.
 * ⚠ `state === "ended"` IS WHAT MARKS A DEAD AGENT, never `endedAt` — that stamp is additive and
 * absent on an older main, so gating on it would call every legacy ended agent live
 * (INVARIANTS §11).
 */
export function deleteAgentCopy(state: string | null | undefined): string {
  const line = "Deletes the agent and its session history.";
  return state === "ended" ? line : `${line} It is still running — this ends it first.`;
}

/**
 * The trash icon plus its confirmation.
 *
 * ⚠ NAKED GLYPH, REVEALED BY THE CARD'S HOVER — the row-level affordance idiom
 * (docs/DESIGN-SYSTEM.md § Row-level edit affordances): `IconButton bare`, `opacity-0` rather
 * than `hidden` so the card does not reflow when the cursor arrives, and `focus-visible` reveals
 * it too, because a control reachable by Tab that stays invisible while focused is a trap.
 * ⚠ THE HOVER GROUP IS NAMED (`group/card`) — the card owns it and the rename pencil already
 * rides it; an anonymous `group` would make any nested hover reveal both.
 */
export function AgentDeleteButton({
  agent,
  onDeleted,
}: {
  agent: DesktopSessionSummary;
  /** Fired after main confirms. ⚠ Optional: the card leaves on the next summary push either
   *  way — this is for a caller that wants to close something pointed at the agent. */
  onDeleted?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  if (!canDeleteAgent() || !agent.agentId) return null;

  const name = agentDisplayName(agent);

  /**
   * ⚠ A THROW KEEPS THE DIALOG OPEN — that is `ConfirmDialog`'s contract, and it is what turns
   * a refusal into something the operator can retry rather than a button that visibly did
   * nothing. Main's verdict is never swallowed here (`agents-controls.ts`'s standing rule).
   */
  async function handleConfirm(): Promise<void> {
    const op = getSpaBridge()?.sessions?.delete;
    if (typeof op !== "function") throw new Error("no-bridge");
    const res = await op(agent.channelId, agent.taskId, agent.agentId ?? "");
    if (res?.ok !== true) throw new Error(res?.reason || "refused");
    onDeleted?.();
  }

  return (
    <>
      <IconButton
        icon={Trash2}
        label={`Delete ${name}`}
        size={13}
        bare
        onClick={() => setConfirming(true)}
        className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover/card:opacity-100"
      />
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Delete agent"
        description={deleteAgentCopy(agent.state)}
        confirmLabel="Delete"
        destructive
        onConfirm={handleConfirm}
      />
    </>
  );
}
