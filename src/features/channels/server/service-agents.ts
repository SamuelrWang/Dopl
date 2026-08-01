import "server-only";
import type { AgentStatus, ChannelAgent } from "../types";
import type { ChannelAgentCreateInput } from "../schema";
import { pickAgentName } from "./agent-names";
import { mapAgentRow, type ChannelAgentRow } from "./agents-dto";
import {
  ChannelAgentForbiddenError,
  ChannelAgentNameConflictError,
  ChannelAgentNotFoundError,
  ChannelForbiddenError,
} from "./errors";
import * as repo from "./repository";
import * as repoAgents from "./repository-agents";
import {
  loadVisibleChannel,
  UNIQUE_VIOLATION,
  type ChannelContext,
} from "./service-shared";

/**
 * Channel agents: summon (`/new-agent`), list, rename, set status.
 *
 * An AGENT is a first-class named entity inside a channel, summoned by its
 * OWNER and running on THAT owner's machine. Two authorization rules carry the
 * whole file:
 *
 *  - **Reading is the CHANNEL's rule.** The roster is visible to everyone who
 *    can read the room (`loadVisibleChannel`), because a peer has to be able to
 *    see a handle before they can @-address it. It matches the table's own RLS
 *    SELECT policy, so the service and the database agree.
 *  - **Writing is the OWNER's rule.** Summoning needs channel membership;
 *    renaming and status changes need to be the agent's owner. An agent is not
 *    a shared resource — it is a member's process on a member's machine, and a
 *    teammate parking or renaming it would be reaching into that machine.
 *
 * Thread participation (which agents are admitted to which breakout room) is a
 * different question with different gates and lives in `service-participants.ts`.
 */

/**
 * How many times a POOL pick will re-try after losing the unique index race.
 *
 * A pick is a candidate, not a reservation (see `agent-names.ts`): two members
 * summoning at the same moment read the same roster and can choose the same
 * handle. The loser adds the winner's handle to its own `taken` set and picks
 * again — which is guaranteed to be a DIFFERENT handle, so each round makes
 * progress. Three rounds covers any plausible concurrency in one room; beyond
 * that the raw error surfaces rather than spinning.
 */
const NAME_PICK_ATTEMPTS = 3;

/**
 * Every agent in the channel, oldest first. Visibility is the channel's READ
 * gate — a private channel reads as not-found to a non-member, so an outsider
 * cannot enumerate a room's agents.
 */
export async function listAgents(
  ctx: ChannelContext,
  ref: string
): Promise<ChannelAgent[]> {
  const { channel } = await loadVisibleChannel(ctx, ref);
  const rows = await repoAgents.listAgentsByChannel(channel.id);
  return rows.map(mapAgentRow);
}

/**
 * Summon an agent into the channel. The caller must be a channel MEMBER (a
 * non-member viewing a public channel may read the roster but not add to it)
 * and becomes the agent's owner.
 *
 * With no `name`, the server picks the next free handle from the curated pool.
 * With one, it is validated by the schema (charset) and here (uniqueness) — a
 * taken handle is a 409 rather than a silent alternative, because a caller that
 * asked for `quartz` and got `onyx` would go on to @-address the wrong agent.
 */
export async function createAgent(
  ctx: ChannelContext,
  ref: string,
  input: ChannelAgentCreateInput
): Promise<ChannelAgent> {
  const { channel, membership } = await loadVisibleChannel(ctx, ref);
  if (!membership) {
    throw new ChannelForbiddenError("summon an agent in this channel");
  }

  const roster = await repoAgents.listAgentsByChannel(channel.id);
  // Dismissed agents keep their rows (attribution history), so their handles
  // stay taken — re-using one would re-attribute an old message to a new agent.
  const taken = new Set(roster.map((row) => row.name.toLowerCase()));

  if (input.name) {
    if (taken.has(input.name)) {
      throw new ChannelAgentNameConflictError(input.name);
    }
    return mapAgentRow(await insertNamed(ctx, channel.id, input.name));
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < NAME_PICK_ATTEMPTS; attempt += 1) {
    const name = pickAgentName(taken);
    try {
      return mapAgentRow(await insertAgentRow(ctx, channel.id, name));
    } catch (err) {
      if (repo.pgErrorCode(err) !== UNIQUE_VIOLATION) throw err;
      // Someone else took this handle between the read and the insert. It is
      // genuinely taken now, so record it and pick the next free one.
      taken.add(name);
      lastError = err;
    }
  }
  throw lastError;
}

/**
 * Insert an EXPLICITLY named agent, mapping the index's own verdict to a 409.
 * The pre-check above is an optimization and a nicer error path; this is the
 * one that actually holds, because the read and the insert are not atomic.
 */
async function insertNamed(
  ctx: ChannelContext,
  channelId: string,
  name: string
): Promise<ChannelAgentRow> {
  try {
    return await insertAgentRow(ctx, channelId, name);
  } catch (err) {
    if (repo.pgErrorCode(err) === UNIQUE_VIOLATION) {
      throw new ChannelAgentNameConflictError(name);
    }
    throw err;
  }
}

function insertAgentRow(
  ctx: ChannelContext,
  channelId: string,
  name: string
): Promise<ChannelAgentRow> {
  return repoAgents.insertAgent({
    channel_id: channelId,
    workspace_id: ctx.workspaceId,
    owner_user_id: ctx.userId,
    name,
  });
}

/**
 * Rename an agent. OWNER ONLY. A handle already held in this channel is a 409
 * (the repository returns null on 23505 precisely so this maps cleanly).
 */
export async function renameAgent(
  ctx: ChannelContext,
  ref: string,
  agentId: string,
  name: string
): Promise<ChannelAgent> {
  const agent = await loadOwnedAgent(ctx, ref, agentId, "rename this agent");
  const row = await repoAgents.updateAgentName(agent.id, name);
  if (!row) throw new ChannelAgentNameConflictError(name);
  return mapAgentRow(row);
}

/**
 * Move an agent along its lifecycle. OWNER ONLY — the states describe a process
 * on the owner's machine.
 *
 * `dismissed` is a STATUS, not a delete: the row survives so every message the
 * agent already authored keeps its attribution, and so its handle stays taken.
 * There is deliberately no delete op anywhere in this lane.
 */
export async function setAgentStatus(
  ctx: ChannelContext,
  ref: string,
  agentId: string,
  status: AgentStatus
): Promise<ChannelAgent> {
  const agent = await loadOwnedAgent(
    ctx,
    ref,
    agentId,
    "change this agent's status"
  );
  return mapAgentRow(await repoAgents.updateAgentStatus(agent.id, status));
}

/**
 * Resolve an agent the caller OWNS, inside a channel the caller can see.
 *
 * The three failures are deliberately distinct: a channel the caller cannot
 * read is a 404 on the CHANNEL (via `loadVisibleChannel`, so its existence
 * never leaks); an agent id that names no row of THIS channel is a 404 on the
 * agent (collapsed, so an id from another room cannot be probed); an agent that
 * exists here but belongs to someone else is a 403, because refusing to admit
 * it exists would be a lie the roster already contradicts.
 */
async function loadOwnedAgent(
  ctx: ChannelContext,
  ref: string,
  agentId: string,
  action: string
): Promise<ChannelAgentRow> {
  const { channel } = await loadVisibleChannel(ctx, ref);
  const agent = await repoAgents.findAgentById(agentId);
  if (!agent || agent.channel_id !== channel.id) {
    throw new ChannelAgentNotFoundError(agentId);
  }
  if (agent.owner_user_id !== ctx.userId) {
    throw new ChannelAgentForbiddenError(action);
  }
  return agent;
}
