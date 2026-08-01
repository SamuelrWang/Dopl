/**
 * MULTIPLAYER methods for `DoplClient` — channel AGENTS and thread
 * PARTICIPANTS. Free functions over `DoplTransport`, wired into the client
 * class in client.ts, exactly like `channel.ts`.
 *
 * THE MODEL these routes serve: a channel is a ROOM (its human members plus
 * the named agents they summon); a thread with a participant set is a BREAKOUT
 * ROOM inside it. An agent is a first-class named entity owned by ONE member
 * and running on THAT member's machine, which is why every write here is
 * owner- or member-gated server-side.
 *
 * Split out of `channel.ts` rather than added to it: that file is the
 * message/thread surface (post, read, the long-poll) and these are identity
 * and membership. Neither had to grow toward the §2 cap for the other.
 *
 * BOUNDARY, unchanged: the wire/storage name `task` == the domain name
 * `thread`. The participant routes live under `/tasks/[taskId]/participants`
 * and their column is `task_id`; everything above this line says `thread`.
 */

import type { DoplTransport } from "./transport.js";
import type {
  ChannelAgent,
  ChannelAgentCreateInput,
  ChannelAgentUpdateInput,
  ThreadParticipant,
  ThreadParticipantRef,
} from "./channel-types.js";

const enc = encodeURIComponent;

// ─── Agents ─────────────────────────────────────────────────────────

/**
 * The channel's agent roster, oldest first. A READ gated by the CHANNEL's own
 * visibility rule, not by ownership: a peer has to be able to see a handle
 * before it can address it.
 */
export async function listChannelAgents(
  t: DoplTransport,
  channelId: string
): Promise<ChannelAgent[]> {
  const data = await t.request<{ agents: ChannelAgent[] }>(
    `/api/channels/${enc(channelId)}/agents`,
    { toolName: "channel_agents" }
  );
  return data.agents;
}

/**
 * Summon an agent into the channel; the caller becomes its owner. With no
 * `name` the server picks the next free handle from its curated pool — the
 * normal path, and the one that cannot collide.
 */
export async function createChannelAgent(
  t: DoplTransport,
  channelId: string,
  input: ChannelAgentCreateInput = {}
): Promise<ChannelAgent> {
  const data = await t.request<{ agent: ChannelAgent }>(
    `/api/channels/${enc(channelId)}/agents`,
    {
      method: "POST",
      body: input,
      toolName: "channel_summon_agent",
    }
  );
  return data.agent;
}

/**
 * Rename an agent, move it along its lifecycle, or DISENGAGE it.
 *
 * AUTHORIZATION IS NOT UNIFORM, and the route enforces it (403 from there, not
 * from here). `rename` / `set_status` are OWNER ONLY — an agent is a member's
 * process on a member's machine, so a teammate renaming or parking it would be
 * reaching into that machine. `disengage` is the owner OR the human recorded in
 * `engaged_by`: engagement is a relationship between an agent and the person who
 * addressed it, and ending an agent's attention to YOUR OWN messages is not the
 * same act as parking somebody else's process.
 */
export async function updateChannelAgent(
  t: DoplTransport,
  channelId: string,
  agentId: string,
  input: ChannelAgentUpdateInput
): Promise<ChannelAgent> {
  const data = await t.request<{ agent: ChannelAgent }>(
    `/api/channels/${enc(channelId)}/agents/${enc(agentId)}`,
    {
      method: "PATCH",
      body: input,
      toolName: "channel_update_agent",
    }
  );
  return data.agent;
}

// ─── Thread participants ────────────────────────────────────────────

/**
 * Admit an identity to a thread's participant set. IDEMPOTENT: an identity
 * already in the set comes back as the row that is already there (the route
 * answers 200 instead of 201), so a retried join converges instead of
 * erroring. The response body is the same either way, which is why this
 * returns the participant rather than the status.
 */
export async function addThreadParticipant(
  t: DoplTransport,
  channelId: string,
  threadId: string,
  identity: ThreadParticipantRef
): Promise<ThreadParticipant> {
  const data = await t.request<{ participant: ThreadParticipant }>(
    `/api/channels/${enc(channelId)}/tasks/${enc(threadId)}/participants`,
    {
      method: "POST",
      body: identity,
      toolName: "channel_join_thread",
    }
  );
  return data.participant;
}

/**
 * Remove an identity from a thread's participant set. Idempotent as well —
 * removing an identity that is not in the set is a no-op, so the route answers
 * `{ ok: true }` whether or not a row went away, and there is nothing useful
 * to hand back.
 *
 * A DELETE with a BODY: the identity is a `{kind, id}` pair rather than a path
 * segment, because the pair is what the row's unique index is on. The
 * transport sends it the same way it sends any other mutation body.
 */
export async function removeThreadParticipant(
  t: DoplTransport,
  channelId: string,
  threadId: string,
  identity: ThreadParticipantRef
): Promise<void> {
  await t.request<{ ok: boolean }>(
    `/api/channels/${enc(channelId)}/tasks/${enc(threadId)}/participants`,
    {
      method: "DELETE",
      body: identity,
      toolName: "channel_leave_thread",
    }
  );
}
