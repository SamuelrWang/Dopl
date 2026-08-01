/**
 * Pure display + validation helpers for CHANNEL AGENTS (multiplayer wave 2).
 *
 * A channel agent is a first-class named entity summoned by its owner
 * (`/new-agent`) and addressed by handle (`@quartz`). Everything here is pure so
 * the chips bar, the composer's mention list, and the transcript's attribution
 * all state the same rules without a DOM.
 *
 * THE OWNER RULE, in one place: only `agent.ownerUserId === viewerUserId` may
 * rename, park, or dismiss an agent. Every affordance that writes gates on
 * {@link isAgentOwner}; the server re-checks it (this is UI legibility, not
 * authorization).
 */

import { AGENT_HANDLE_RE } from "../schema";
import type { AgentStatus, ChannelAgent } from "../types";

/** The one sentence the rename field says when a handle is refused. */
export const AGENT_HANDLE_HINT =
  "Lowercase letters, numbers and dashes. 2–31 characters, starting with a letter.";

/**
 * What the server will actually store: `AgentHandleSchema` trims and CASE-FOLDS
 * before testing the charset, so the field must normalize the same way or a
 * typed "Quartz" would read as invalid here and be accepted there.
 */
export function normalizeAgentHandle(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * True when `name` normalizes to a legal handle. The charset itself is the ONE
 * copy in `schema.ts` (re-exported from `schema-agents.ts`) — a client regex
 * looser than the column CHECK turns a typo into a 500, and a second copy is a
 * second thing to drift.
 */
export function isValidAgentHandle(name: string): boolean {
  return AGENT_HANDLE_RE.test(normalizeAgentHandle(name));
}

/** Human label per lifecycle state (chips, popovers, mention sublabels). */
export const AGENT_STATUS_LABEL: Record<AgentStatus, string> = {
  summoned: "Summoned",
  active: "Working",
  parked: "Parked",
  dismissed: "Dismissed",
};

/**
 * The status dot recipe, in design tokens only.
 *
 * - `summoned` — created, not yet running: a PULSING warning dot (something is
 *   expected to start).
 * - `active` — a session is working: a SOLID success dot, matching `PresenceDot`.
 * - `parked` / `dismissed` — suspended or retired: a HOLLOW ring, so a stopped
 *   agent never reads as live ink.
 */
export function agentStatusDotClass(status: AgentStatus): string {
  switch (status) {
    case "summoned":
      return "bg-warning animate-pulse";
    case "active":
      return "bg-success";
    default:
      return "border border-text-disabled bg-transparent";
  }
}

/** A dismissed agent is retired: its row survives for attribution, its chip does not. */
export function visibleAgents(agents: readonly ChannelAgent[]): ChannelAgent[] {
  return agents.filter((a) => a.status !== "dismissed");
}

/** `summoned` + `active` are the ADDRESSABLE states (see `types.ts`). */
export function isAddressableAgent(agent: ChannelAgent): boolean {
  return agent.status === "summoned" || agent.status === "active";
}

/** Only the summoner may rename / park / dismiss. */
export function isAgentOwner(
  agent: ChannelAgent,
  viewerUserId: string | undefined
): boolean {
  return !!viewerUserId && agent.ownerUserId === viewerUserId;
}

/**
 * "Your agent" / "Ada's agent" — whose machine it runs on, never a bare name.
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

/**
 * The server-stamped `metadata.author_agent_id`, read DEFENSIVELY: metadata is
 * an open jsonb bag, so a non-string (or absent) value is simply "no agent".
 * This value is DISPLAY ONLY — it names which chip to draw and nothing else.
 */
export function readAuthorAgentId(
  metadata: Record<string, unknown> | null | undefined
): string | null {
  if (!metadata) return null;
  const raw = metadata.author_agent_id;
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

/** The rendered attribution for an agent-authored message. */
export interface AgentAttribution {
  /** The agent's handle, as typed in an @-mention. */
  handle: string;
  /** "Your agent" / "Ada's agent". */
  ownerLabel: string;
}

/**
 * Resolve a message's authoring agent to its handle + owner phrase, or null
 * when the message carries no `author_agent_id`, or when it names an agent this
 * client has not loaded (a dismissed agent from another era, a stale row, a
 * forged key). Null means "render exactly what we rendered before" — the
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
