/**
 * HISTORICAL AGENT ATTRIBUTION — what is left of the named-agent display layer.
 *
 * A channel agent used to be a first-class named entity: summoned with
 * `/new-agent`, addressed as `@quartz`, renamed, parked and dismissed by its
 * owner. This module carried the rules every one of those affordances stated —
 * the handle charset, the status labels and dot recipe, the owner rule, the
 * addressable states. All of it is gone (rollback §1) with the surfaces that
 * used it.
 *
 * ONE JOB REMAINS, and it is about the past rather than the present: a stored
 * message stamped `metadata.author_agent_id` still has to render "quartz ·
 * Ada's agent" the way it did on the day it was posted. Everything here is pure
 * so the transcript can state that without a DOM.
 */

import type { ChannelAgent } from "../types";

/**
 * The server-stamped `metadata.author_agent_id`, read DEFENSIVELY: metadata is
 * an open jsonb bag, so a non-string (or absent) value is simply "no agent".
 * This value is DISPLAY ONLY — it names which handle to draw and nothing else,
 * and nothing writes it any more (`server/service-writes-metadata.ts` strips it
 * from every new post and never re-stamps it).
 */
export function readAuthorAgentId(
  metadata: Record<string, unknown> | null | undefined
): string | null {
  if (!metadata) return null;
  const raw = metadata.author_agent_id;
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

/**
 * "Your agent" / "Ada's agent" — whose machine it ran on, never a bare name.
 * Falls back to a neutral phrase when the owner is not on the loaded roster
 * (a member who left still owns the messages their agent authored).
 */
export function agentOwnerLabel(
  agent: ChannelAgent,
  memberNames: ReadonlyMap<string, string>,
  viewerUserId: string | undefined
): string {
  if (viewerUserId && agent.ownerUserId === viewerUserId) return "Your agent";
  const owner = memberNames.get(agent.ownerUserId);
  return owner ? `${owner}'s agent` : "A teammate's agent";
}

/** The rendered attribution for an agent-authored message. */
export interface AgentAttribution {
  /** The agent's handle, as it was typed in an @-mention. */
  handle: string;
  /** "Your agent" / "Ada's agent". */
  ownerLabel: string;
}

/**
 * Resolve a message's authoring agent to its handle + owner phrase, or null
 * when the message carries no `author_agent_id`, or when it names an agent this
 * client has not loaded (a row from a channel we only partly read, a forged
 * key). Null means "render exactly what we render for any agent message" — the
 * fallback is never an error state.
 */
export function agentAttributionFor(
  message: { metadata: Record<string, unknown> },
  agents: readonly ChannelAgent[],
  memberNames: ReadonlyMap<string, string>,
  viewerUserId: string | undefined
): AgentAttribution | null {
  const agentId = readAuthorAgentId(message.metadata);
  if (!agentId) return null;
  const agent = agents.find((a) => a.id === agentId);
  if (!agent) return null;
  return {
    handle: agent.name,
    ownerLabel: agentOwnerLabel(agent, memberNames, viewerUserId),
  };
}
