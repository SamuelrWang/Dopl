/**
 * Which posts wear a channel agent's colour: an agent post with a stamped `agentId` gets an accent
 * (its live colour, else neutral); people and channel-less agent posts get none. The transcript
 * paints with it and the transcript filter's "People" option is its complement: one rule, one file.
 */

import { agentColorVar } from "../lib/agent-colors";
import type { AgentColorKey } from "../types";
import type { AuthoredRowAccent } from "./authored-row";
import type { AuthorIndex } from "./view-model";
import type { MessageRow } from "./view-model-rows";

/** `{ color: null }` is a neutral accent (ended/unassigned agent), unlike no accent (`null`). */
export type AgentBox = { color: AgentColorKey | null };

/** Structural so escalation rows ask the same question as message rows. */
export type AgentAuthored = Pick<MessageRow, "agent" | "agentId">;

/** An ended agent's paint: still an accent, in the neutral the filter's ended dot also uses. */
export const AGENT_ACCENT_NEUTRAL = "var(--border-strong)";

/** The one place a row's colour key becomes a CSS `var()` reference. */
export function agentPostAccent(box: AgentBox): AuthoredRowAccent {
  return {
    key: box.color,
    paint: box.color ? agentColorVar(box.color) : AGENT_ACCENT_NEUTRAL,
  };
}

/** A row's accent, or `null` for none. Not gated on `index.agents` membership (a peer's or departed
 *  agent still gets the neutral face); colour is read at render, never stamped. */
export function agentBoxOf(row: AgentAuthored, index: AuthorIndex): AgentBox | null {
  if (!row.agent) return null;
  const agentId = row.agentId;
  if (agentId === null) return null;
  return { color: index.agents.get(agentId)?.color ?? null };
}
