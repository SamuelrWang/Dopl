/**
 * **WHICH POSTS WEAR A COLOURED BOX, AND WHAT COLOUR** — one predicate, one file
 * (Samuel, 2026-09-13; docs/specs/agent-colors.md).
 *
 * ── ⚠ WHY THIS IS ITS OWN MODULE AND NOT A HELPER INSIDE EITHER CALLER ─────────────
 *
 * **TWO SURFACES ASK THIS QUESTION AND A DISAGREEMENT BETWEEN THEM IS INVISIBLE.**
 * `message-box-agent.tsx` asks it to paint, and `transcript-filter.tsx` asks it to
 * FILTER — because Samuel defined the People option by the paint rather than by the
 * data: *"Just users, which would include desktop agents as well: all of the messages
 * that don't have a colored box around them."* So "People" is literally the complement
 * of this function, and two spellings of it would mean a post that renders boxed and
 * filters as a person, which no test on either side would catch because each side
 * would be self-consistent.
 *
 * ⚠ IT IS A `.ts` AND NOT A `.tsx`: no JSX, no React import, and a component cannot
 * accidentally start hanging state off it.
 * ⚠ AND IT DOES NOT LIVE IN `view-model-rows.ts` (485 lines when this landed), which is
 * §1's cap answered — but the seam is the sharing either way: that file builds ROWS out
 * of messages and moves when a row's shape moves; this reads a built row against the
 * live index and moves when the colour rule moves.
 */

import type { AgentColorKey } from "../types";
import type { AuthorIndex } from "./view-model";
import type { MessageRow } from "./view-model-rows";

/**
 * A ROW'S BOX, or `null` for "no box at all".
 *
 * ⚠ **THE TWO ANSWERS ARE NOT THE SAME QUESTION AND CONFLATING THEM IS THE BUG THIS
 * SHAPE EXISTS TO PREVENT.** `null` means NO FRAME — a person, or a channel-less MCP
 * post. `{ color: null }` means A NEUTRAL FRAME — an agent session whose colour is
 * gone or was never assigned. A single `AgentColorKey | null` return could not tell
 * those apart, and the filter would then read every ended agent's posts as a person's.
 */
export type AgentBox = { color: AgentColorKey | null };

/**
 * **IS THIS POST A CHANNEL AGENT SESSION'S, AND WHAT COLOUR IS IT WEARING RIGHT NOW?**
 *
 * ⚠ **THE DISCRIMINATOR IS A STAMPED SESSION ID, WHICH IS EXACTLY SAMUEL'S LINE.** He
 * drew it twice, once each way: *"If it's an agent in Dopl that's sending something,
 * that should be a specific color"* and *"For desktop agents and for messages from
 * users, keep those white and without any box."* A "Desktop agent" post is an MCP write
 * from a session that belongs to no channel — `authorKind` says `agent` and there is no
 * instance id to stamp — so `row.agent && row.agentId !== null` separates the two
 * populations with no third field and no list of kinds to keep in step.
 *
 * ⚠ **MEMBERSHIP OF `index.agents` IS NOT PART OF THE TEST, AND THAT IS DELIBERATE.**
 * `transcript.tsx`'s OPENABLE gate is `index.agents.has(agentId)` because a pane can
 * only be opened for a session on THIS machine; a BOX is the opposite — Samuel ruled it
 * covers *"not only for the own users' agents, but also for other users' agents"*. A
 * peer's agent reaches the index through the projection union
 * (`derivations.ts` ← `use-channel-agent-sessions.ts`), but an agent whose row has
 * already left the poll's answer must still wear the neutral frame rather than
 * silently demote to a person's row.
 *
 * ⚠ **THE COLOUR IS READ AT RENDER AND IS NEVER ON THE ROW.** `AgentIdentity.color`
 * carries the argument in full: the key returns to the channel's bank when the session
 * ends, so a stamped colour would keep painting a hue another member now owns.
 */
export function agentBoxOf(row: MessageRow, index: AuthorIndex): AgentBox | null {
  if (!row.agent) return null;
  const agentId = row.agentId;
  if (agentId === null) return null;
  // ⚠ `?? null` RATHER THAN A `has` TEST FIRST: an agent this index has never heard of
  // and one it knows to have ended are the same face, and asking twice would invite a
  // third branch for the difference.
  return { color: index.agents.get(agentId)?.color ?? null };
}
