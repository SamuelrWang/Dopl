/**
 * **WHO AN AGENT IS ON A SURFACE** — whether it is still running, the NAME it wears, and what
 * tells two of them apart (§1 split, 2026-09-15).
 *
 * ⚠ **ITS OWN FILE BECAUSE `agents-model.ts` WENT OVER THE 500-LINE CAP** during the 2026-09-15
 * id-visibility wave, and the seam is a real one rather than arithmetic: everything here changes
 * when the IDENTITY VOCABULARY changes — what an unnamed agent is called, what counts as running
 * — and that file changes when the LIST arithmetic does (which channel, which thread, which
 * metric, which peer card). Same arrangement `lib/agent-mentions-responder.ts` has, and the same
 * import direction: this is a leaf that file consumes. ⚠ **IT STAYS SPLIT** even though the
 * function that pushed it over is since deleted (see the grave at the foot of this file): the
 * seam was the right one on its own terms, and re-merging would move code for arithmetic.
 *
 * ⚠ **`agents-model.ts` RE-EXPORTS ALL THREE SYMBOLS AND STAYS THE IMPORT PATH OF RECORD** (§1),
 * so no caller moved and there is no second path to one of these names.
 *
 * ⚠ **`"use client"` IS DELIBERATELY ABSENT.** Nothing here touches React or a browser API, and
 * the one thing that must not happen is a SERVER projection being unable to ask for the same
 * face — which is exactly the leak `home/server/overview-tally.ts` shipped by inventing its own.
 * The shared face itself lives one level down again, in `shared/lib/agent-name.ts`.
 */

import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { NEW_AGENT_NAME } from "@/shared/lib/agent-name";

/**
 * IS THIS AGENT STILL RUNNING — the ONE ended-state rule, shared by the own list
 * and the peer list (Samuel, 2026-08-20).
 *
 * ⚠ IT EXISTS BECAUSE THE TWO LISTS USED TO DISAGREE. `peerCardsFor` dropped
 * `ended` and `ownAgentsFor` did not, so the Agents tab's badge — which sums both
 * — counted MY stopped agents and not my teammates'. One number over two rules is
 * the F-142 defect in miniature, and a badge is exactly where it goes unnoticed.
 *
 * ⚠ THE LIST AND THE BADGE ANSWER DIFFERENT QUESTIONS, DELIBERATELY. The badge
 * counts what is ACTIVE; the own LIST still renders an ended agent as a stopped
 * card, because "my agent just finished" is something the operator opened the tab
 * to see. A peer's ended row is not shown either way — the server row outlives the
 * run it describes, so it is not evidence of anything.
 */
export function isAgentActive(state: DesktopSessionSummary["state"]): boolean {
  return state !== "ended";
}

/**
 * THE AGENT'S OWN ID — what every surface in this family SHOWS where a stone
 * handle used to be (Samuel, 2026-08-21, multiplayer agents).
 *
 * ⚠ THE STONE-NAME POOL IS DELETED, and the reason is not taste. `quartz` / `flint` / `onyx`
 * named ONE agent per channel — a promise multiplayer cannot keep, since every launch mints a NEW
 * instance and several sit on one thread. Main mints a random 8-char id per instance instead, and
 * that id is the only thing an operator can say out loud to tell two of their own agents apart.
 *
 * ⚠ READ OPTIONALLY, AND IT FALLS BACK TO `name`. A main older than the id emits a handle and
 * nothing else, and the card must read exactly as it did before this existed — a blank header is
 * strictly worse than a legacy name (INVARIANTS §11). It is read off the summary rather than
 * declared on `spa-bridge.ts › DesktopSessionSummary`, which is the DESKTOP's to widen.
 *
 * ⚠ **IT HAS NO PRODUCTION CALLER AT ALL SINCE 2026-09-15, AND THAT IS ITS JOB NOW.** It was
 * {@link agentDisplayName}'s internal fallback until Samuel's ruling replaced the `#<id>` face
 * with `New Agent`; what it is kept for is `agent-id-visibility.test.ts`, which BANS the symbol
 * by name across every component in this directory. A banned symbol has to exist to be banned —
 * deleting it would turn the sweep's strongest assertion into a search for nothing.
 */
export function agentDisplayId(session: {
  agentId?: string | null;
  name?: string | null;
}): string {
  const id = typeof session.agentId === "string" ? session.agentId.trim() : "";
  return id || session.name || "Agent";
}

/**
 * THE SAME AGENT, SAID IN FULL: the operator's own name, else `New Agent`.
 *
 * ⚠ **IT WAS `#<id>` FROM 2026-08-31 TO 2026-09-15** (and `Agent #<id>` from 2026-08-24), and
 * Samuel withdrew it: *"right now, the agent IDs we have, I want to make it so that the user
 * really doesnt see it … if a user launches an agent with no name, just give it the name, New
 * Agent"*. **This function is where that leaked from** — every card, header, OS window title,
 * rail tab, thread-Info row, rename field, filter row and @-picker row resolves through it, so
 * one `#${id}` here put eight machine characters on a dozen surfaces at once. The face is
 * `shared/lib/agent-name.ts › NEW_AGENT_NAME` now, shared with the transcript pill and with
 * the Home board's server projection so the three cannot spell it differently.
 *
 * ⚠ **INVARIANTS §11's CARVE-OUT IS WITHDRAWN WITH IT.** That row defended the old fallback as
 * *"a NAME the operator was shown at launch and accepted, not an id leaking through"* — true
 * only while the launch dialog PREFILLED it, which was itself the thing Samuel asked to stop
 * (`use-agent-launch.ts`, the prefill is deleted). The defence and the defect were the same
 * mechanism.
 *
 * ⚠ THE WORD "agent" IS STILL NOT IN THE NAME'S SEAT for a NAMED agent: agent-ness is stated by
 * the grey borderless chip beside it (`attribution-pill.tsx › AgentChip`). The unnamed face
 * carries the word because there is nothing else to say, and a chip beside "New Agent" reads as
 * a label on a thing, not as the word twice.
 * ⚠ PRECEDENCE, unchanged in shape: operator's OWN name, then the canonical unnamed face, then
 * — only where no name and no id were reported at all — the legacy pool handle, which is a real
 * label a pre-2026-08-21 main emitted and is not an id.
 */
export function agentDisplayName(session: {
  agentId?: string | null;
  name?: string | null;
  displayName?: string | null;
}): string {
  const own = typeof session.displayName === "string" ? session.displayName.trim() : "";
  if (own) return own;
  // ⚠ THE LEGACY HANDLE STILL OUTRANKS THE GENERIC FACE, and only in the one case it can:
  // a main that reports a `name` and NO `agentId` is pre-2026-08-21, and `flint` is a label its
  // operator actually read on a pill. Where an id IS reported the name is the id itself
  // (`main/session-summary.js › nameOf`), so it must not be shown — which is exactly the leak
  // `home/server/overview-tally.ts › mapAgents` had.
  const id = typeof session.agentId === "string" ? session.agentId.trim() : "";
  if (!id) {
    const legacy = typeof session.name === "string" ? session.name.trim() : "";
    if (legacy) return legacy;
  }
  return NEW_AGENT_NAME;
}

// ⚠ **`agentNameDiscriminators` LIVED HERE FOR PART OF 2026-09-15 AND IS DELETED.** It answered
// which own-agent cards needed a muted `#<id>` beside the name, for the case where two ADDRESSABLE
// agents in one list wore the same face — the one carve-out Samuel's first ruling left for showing
// an id to a person. **His second ruling that day removed the case rather than the display**: no
// two addressable agents in a channel can share a name, because the second is stored as `Coder-1`
// (`dopl-desktop-app/main/agent-name-unique.js`). A discriminator for a collision that cannot
// happen is chrome nobody will ever see and a branch nothing can test.
// ⚠ **ENDED AGENTS MAY STILL SHARE A NAME** (*"If an agent is ended, they can't be addressed
// anyway, so it won't matter"*) and are deliberately shown UNSUFFIXED — there is nothing to
// choose between, and a `#<id>` on a finished run is the leak this wave exists to remove.

