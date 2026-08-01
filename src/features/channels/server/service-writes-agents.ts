import "server-only";
import { isUuid } from "@/shared/lib/id/uuid";
import type { ChannelMessageCreateInput } from "../schema";
import type { ChannelAgentRow } from "./agents-dto";
import {
  ChannelAddresseeNotMemberError,
  ChannelAgentForbiddenError,
  ChannelAgentNotInChannelError,
} from "./errors";
import * as repo from "./repository";
import * as repoAgents from "./repository-agents";
import type { ChannelContext } from "./service-shared";

/**
 * AGENT ADDRESSING on a post: who a message is FOR (`toAgent`) and who it is
 * FROM (`authorAgentId`). Split out of `service-writes-metadata.ts` because it
 * is its own reason to change — the metadata module decides what lands in
 * `metadata`, this one decides which agent identities a caller may name at all.
 *
 * THE IDENTITY LAW, stated once: an agent id SUPPLEMENTS an author, it never
 * REPLACES one. `channel_messages.author_user_id` stays `ctx.userId` on every
 * path; `metadata.author_agent_id` says which of that human's agents wrote it.
 * There is no anonymous agent authorship, and no way to attribute a message to
 * a human who did not make the request.
 *
 * The two fields fail DIFFERENTLY, on purpose:
 *  - `toAgent` names something the caller does not own and cannot be expected
 *    to know the id of, so it resolves by id OR handle and a miss is a **400**
 *    about the address (`CHANNEL_AGENT_NOT_IN_CHANNEL`), mirroring what an
 *    unaddressable human gets (`CHANNEL_ADDRESSEE_NOT_MEMBER`). An agent whose
 *    OWNER has left the channel is a 400 too — see the owner-bridge note in
 *    {@link resolveAgentAddressing}.
 *  - `authorAgentId` names something the caller must own, so a live agent
 *    belonging to someone else is a **403** (`CHANNEL_AGENT_FORBIDDEN`), not a
 *    400 and never a silent drop: a caller trying to post AS another member's
 *    agent is attempting to speak under an identity that is not theirs, and
 *    quietly stripping the claim would let them believe it worked.
 */

/** The validated agent identities a post may carry, all optional. */
export interface AgentAddressing {
  /** `metadata.to_agent_id` — the addressed agent. */
  toAgentId?: string;
  /**
   * The addressed agent's OWNER. The v1 bridge to today's delivery path: the
   * desktop listener triggers on `metadata.to_user_id`, so addressing an agent
   * has to name the machine that agent runs on for anything to happen at all.
   * See {@link resolveAgentAddressing} for what the caller does with it.
   */
  toAgentOwnerUserId?: string;
  /** `metadata.author_agent_id` — which of the caller's agents wrote this. */
  authorAgentId?: string;
}

/**
 * Resolve and authorize the agent identities on a post.
 *
 * `toAgent` accepts an agent id OR a handle. A handle is folded to lowercase by
 * the repository (matching the `(channel_id, lower(name))` unique index), so
 * `@Quartz` and `@quartz` reach the same agent. Either way the row must belong
 * to THIS channel — an agent of another room has no listener here, and a
 * `to_agent_id` pointing at one would look delivered and route nowhere.
 *
 * Status is deliberately NOT checked: a `parked` or `dismissed` agent still
 * resolves. Whether addressing a retired agent should 400 (or wake it) is a
 * product call and is not made here; refusing it today would make a handle stop
 * working the instant its owner parked the session, which is exactly when a
 * teammate is most likely to ping it.
 */
export async function resolveAgentAddressing(
  ctx: ChannelContext,
  channelId: string,
  input: ChannelMessageCreateInput
): Promise<AgentAddressing> {
  const out: AgentAddressing = {};

  if (input.toAgent) {
    const agent = await resolveChannelAgent(channelId, input.toAgent);
    // THE OWNER BRIDGE'S PRECONDITION. `toAgentOwnerUserId` is stamped as
    // `metadata.to_user_id` and TAKES PRECEDENCE over the caller's validated
    // `toUserId` (see `service-writes-metadata.ts`), so without this check the
    // bridge is a hole in the v1.1 "an addressee is an active member of this
    // channel" invariant that `postMessage` 400s on everywhere else:
    // `channel_agents` has no FK to `channel_members`, so an agent outlives its
    // owner's membership, and addressing it would stamp a non-member.
    //
    // CHANNEL_ADDRESSEE_NOT_MEMBER, not the agent-not-in-channel 400: the agent
    // genuinely IS in this channel, and saying otherwise would send the caller
    // looking for a handle problem. What actually failed is the addressee the
    // bridge derived, which is exactly what this error names — and the caller
    // gets the same code they would get for naming that person directly.
    //
    // `findMembership`, not the cheaper `hasMembership` projection, precisely
    // BECAUSE it is the function `postMessage` runs on an explicit `toUserId`:
    // the two answers must never disagree about who is a member, and one
    // predicate is how that stays true.
    if (!(await repo.findMembership(channelId, agent.owner_user_id))) {
      throw new ChannelAddresseeNotMemberError(agent.owner_user_id);
    }
    out.toAgentId = agent.id;
    out.toAgentOwnerUserId = agent.owner_user_id;
  }

  if (input.authorAgentId) {
    const agent = await repoAgents.findAgentById(input.authorAgentId);
    if (!agent || agent.channel_id !== channelId) {
      throw new ChannelAgentNotInChannelError(input.authorAgentId);
    }
    // An agent identity is not assumable. Membership in the channel is not
    // ownership of the agent, so a teammate — even one who can read every
    // handle in the room — cannot author under one.
    if (agent.owner_user_id !== ctx.userId) {
      throw new ChannelAgentForbiddenError("post as this agent");
    }
    out.authorAgentId = agent.id;
  }

  return out;
}

/** One agent of THIS channel, by id or handle, or a 400 about the address. */
async function resolveChannelAgent(
  channelId: string,
  ref: string
): Promise<ChannelAgentRow> {
  const agent = isUuid(ref)
    ? await repoAgents.findAgentById(ref)
    : await repoAgents.findAgentByName(channelId, ref);
  if (!agent || agent.channel_id !== channelId) {
    throw new ChannelAgentNotInChannelError(ref);
  }
  return agent;
}
