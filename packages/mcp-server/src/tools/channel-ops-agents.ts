/**
 * `dopl_channel` MULTIPLAYER op handlers: agents (list) / summon_agent /
 * rename_agent / set_agent_status / join_thread / leave_thread.
 *
 * A NEW file rather than more of `channel-ops-write.ts` (453 lines, §2): these
 * ops are about WHO IS IN THE ROOM, not about what gets said in it. Agent
 * identity itself — how a handle is resolved and how it is rendered — lives one
 * file over in `channel-agent-refs.ts`, because `post`, `create_thread` and
 * `get_thread` all need it and none of them belong here. The `channel-`
 * filename prefix is required by the parity split-scan (parity.test.ts).
 *
 * THE MODEL, once: a CHANNEL is a ROOM — its human members plus the named
 * agents they summon. A THREAD with a participant set is a BREAKOUT ROOM. An
 * agent is owned by ONE member and runs on THAT member's machine, so summoning
 * is member-gated and renaming / parking is owner-gated, server-side.
 *
 * NARRATION: every agent handle here is rendered by {@link agentLabel} and
 * every owner name by `memberRef` — both neutralized, both carrying the
 * immutable id. See the header of `channel-agent-refs.ts` for why a
 * charset-bounded handle is neutralized anyway.
 */

import type {
  AgentStatus,
  ChannelAgent,
  DoplClient,
  ThreadParticipant,
  ThreadParticipantRef,
} from "@dopl/client";
import { ok, err, isAlreadyExists, isNotFound, type ToolResponse } from "./respond";
import {
  inlineOr,
  isErr,
  memberNames,
  resolveChannelOr,
  resolveMemberOr,
} from "./channel-shared";
import { UNTRUSTED_ROSTER_HEADER, memberRef, type MemberView } from "./channel-render";
import {
  NO_AGENT_ID,
  NO_HANDLE,
  agentLabel,
  resolveAgentOr,
} from "./channel-agent-refs";
import {
  classifyForbidden,
  isBadRequest,
  isForbidden,
  serverDetail,
} from "./channel-errors";

/** Fallback for a channel name that neutralized to nothing. */
const NO_NAME = "(unnamed)";

// ─── agents (READ) ──────────────────────────────────────────────────

/**
 * The room's agent roster. A READ: the route gates it on the CHANNEL's own
 * visibility, because a peer has to see a handle before it can address it.
 *
 * Carries {@link UNTRUSTED_ROSTER_HEADER} rather than a fifth header of its
 * own: the untrusted half of these lines is the OWNER's
 * `profiles.display_name` — the same column, set by the same people, that the
 * member roster's header already frames.
 */
export async function opAgents(
  client: DoplClient,
  channelRef: string,
  selfUserId: string | null = null,
): Promise<ToolResponse> {
  const ch = await resolveChannelOr(client, channelRef);
  if (isErr(ch)) return ch;
  const chName = inlineOr(ch.name, NO_NAME);
  const agents = await client.listChannelAgents(ch.id);
  if (agents.length === 0) {
    return ok(
      [
        `No agents in **${chName}** yet.`,
        `Summon one with dopl_channel(op="summon_agent", channel="${ch.id}") — it runs on YOUR machine and acts only when addressed.`,
      ].join("\n"),
    );
  }
  const view: MemberView = { selfUserId, names: await memberNames(client, ch.id) };
  const lines = [
    `## ${chName} — ${agents.length} agent${agents.length === 1 ? "" : "s"}\n`,
    `${UNTRUSTED_ROSTER_HEADER}\n`,
  ];
  for (const a of agents) {
    lines.push(
      `- ${agentLabel(a)} · ${a.status} · summoned by ${memberRef(a.ownerUserId, view)}`,
    );
  }
  lines.push(
    `\nAddress one with dopl_channel(op="post", channel="${ch.id}", to_agent="<handle>", body="...") — addressing is what makes an agent act. An agent's OWNER is the only member who may rename or park it.`,
  );
  return ok(lines.join("\n"));
}

// ─── summon / rename / status (WRITES) ──────────────────────────────

/**
 * Summon an agent into the channel. The caller becomes its OWNER, and the
 * handle comes from the server's curated pool unless one is asked for by name.
 */
export async function opSummonAgent(
  client: DoplClient,
  channelRef: string,
  name?: string,
): Promise<ToolResponse> {
  const ch = await resolveChannelOr(client, channelRef);
  if (isErr(ch)) return ch;
  const chName = inlineOr(ch.name, NO_NAME);
  let agent: ChannelAgent;
  try {
    agent = await client.createChannelAgent(ch.id, name ? { name } : {});
  } catch (e) {
    if (isAlreadyExists(e)) {
      return err(
        `An agent named ${inlineOr(name ?? "", NO_HANDLE)} already exists in **${chName}** — handles are unique per channel, case-insensitively. Nothing was summoned: pick another name, or omit \`name\` and the server takes the next free one from its pool.`,
      );
    }
    if (isForbidden(e)) {
      return err(
        `You can't summon an agent in **${chName}** — you are not a member of it. Nothing was summoned.`,
      );
    }
    if (isBadRequest(e)) {
      return err(
        `That summon was rejected as invalid.${serverDetail(e)} A handle is 2-31 characters: a lowercase letter, then lowercase letters, digits or hyphens. Nothing was summoned.`,
      );
    }
    throw e;
  }
  return ok(
    [
      `Summoned agent ${agentLabel(agent)} into **${chName}** (status ${agent.status}). It is YOURS — it runs on your machine, and only you may rename or park it.`,
      // S3 — the call example takes the agent's ID, not its handle. `to_agent`
      // and `as_agent` both accept either, and the id is the half the SERVER
      // issued: splicing the handle raw into narration is the defect this
      // file's own header forbids, and neutralizing it would put backticks
      // inside a copy-pasteable argument. The handle is still stated, once,
      // through `agentLabel` on the line above.
      `It acts only when ADDRESSED: dopl_channel(op="post", channel="${ch.id}", to_agent="${agent.id}", body="...") — its handle works there too. When it posts, it posts as ITSELF: as_agent set to that same handle or id, which is REQUIRED for anything it writes to be attributed to it at all.`,
    ].join("\n"),
  );
}

/** Rename an agent. OWNER ONLY — the server refuses anyone else. */
export async function opRenameAgent(
  client: DoplClient,
  channelRef: string,
  agentRef: string,
  name: string,
): Promise<ToolResponse> {
  const ch = await resolveChannelOr(client, channelRef);
  if (isErr(ch)) return ch;
  const chName = inlineOr(ch.name, NO_NAME);
  const agent = await resolveAgentOr(client, ch.id, agentRef);
  if (isErr(agent)) return agent;
  const was = agentLabel(agent);
  let renamed: ChannelAgent;
  try {
    renamed = await client.updateChannelAgent(ch.id, agent.id, { op: "rename", name });
  } catch (e) {
    const refused = agentWriteError(e, was, chName, "rename");
    if (refused) return refused;
    throw e;
  }
  return ok(
    `Renamed ${was} to ${agentLabel(renamed)} in **${chName}**. Address it by its NEW handle from here on — the id is unchanged.`,
  );
}

/**
 * Move an agent along its lifecycle. OWNER ONLY — the states describe a
 * process on the owner's own machine.
 */
export async function opSetAgentStatus(
  client: DoplClient,
  channelRef: string,
  agentRef: string,
  status: AgentStatus,
): Promise<ToolResponse> {
  const ch = await resolveChannelOr(client, channelRef);
  if (isErr(ch)) return ch;
  const chName = inlineOr(ch.name, NO_NAME);
  const agent = await resolveAgentOr(client, ch.id, agentRef);
  if (isErr(agent)) return agent;
  const label = agentLabel(agent);
  let updated: ChannelAgent;
  try {
    updated = await client.updateChannelAgent(ch.id, agent.id, {
      op: "set_status",
      status,
    });
  } catch (e) {
    const refused = agentWriteError(e, label, chName, "change the status of");
    if (refused) return refused;
    throw e;
  }
  // `dismissed` is a STATUS, not a delete — say so, because an agent that
  // believes dismissal erases its posts will re-post them under a new handle.
  const note =
    updated.status === "dismissed"
      ? " It keeps its row and its handle, so everything it already posted stays attributed to it."
      : "";
  return ok(`Set ${agentLabel(updated)} in **${chName}** to ${updated.status}.${note}`);
}

/**
 * The refusals both agent writes share, mapped off the status. Null when the
 * error is none of them, so the caller rethrows rather than inventing a cause.
 * `label` is ALREADY render-safe ({@link agentLabel}) — do not re-wrap it.
 */
function agentWriteError(
  e: unknown,
  label: string,
  safeChannelName: string,
  verb: string,
): ToolResponse | null {
  if (isForbidden(e)) {
    return err(
      `You can't ${verb} ${label} — an agent belongs to the member who summoned it, and only that member may rename or park it. Nothing changed.`,
    );
  }
  if (isNotFound(e)) {
    return err(`No such agent in **${safeChannelName}** — nothing changed.`);
  }
  if (isAlreadyExists(e)) {
    return err(
      `That handle is already taken in **${safeChannelName}** — handles are unique per channel, case-insensitively. Nothing changed.`,
    );
  }
  if (isBadRequest(e)) {
    return err(
      `That change was rejected as invalid.${serverDetail(e)} A handle is 2-31 characters: a lowercase letter, then lowercase letters, digits or hyphens. Nothing changed.`,
    );
  }
  return null;
}

// ─── join / leave a breakout room (WRITES) ──────────────────────────

/** Which identity a join/leave names — exactly one of the two. */
interface ParticipantArgs {
  /** A human channel member: an email or user id. */
  member?: string;
  /** An agent of this channel: a handle or an agent id. */
  agent?: string;
}

/**
 * Admit an identity to a thread's participant set — which is what makes the
 * thread a BREAKOUT ROOM. Idempotent server-side: joining twice returns the row
 * already there, so a retry converges instead of erroring.
 */
export async function opJoinThread(
  client: DoplClient,
  channelRef: string,
  threadId: string,
  who: ParticipantArgs,
): Promise<ToolResponse> {
  const ch = await resolveChannelOr(client, channelRef);
  if (isErr(ch)) return ch;
  const chName = inlineOr(ch.name, NO_NAME);
  const resolved = await resolveParticipantOr(client, ch.id, who);
  if (isErr(resolved)) return resolved;
  let participant: ThreadParticipant;
  try {
    participant = await client.addThreadParticipant(ch.id, threadId, resolved.ref);
  } catch (e) {
    const refused = participantWriteError(
      e,
      threadId,
      chName,
      "admit",
      // The CURATION rule, which is what a TASK_FORBIDDEN on a join means.
      `You can't admit anyone to thread ${inlineOr(threadId, NO_AGENT_ID)} — nothing changed, and you have NOT been removed from **${chName}**. A breakout room's participant set is curated by the member who OPENED that thread, the member it is ADDRESSED TO, and the people already in the set; you are none of those. Ask one of them to admit you — dopl_channel(op="post", channel="${ch.id}", to="<one of them>", thread=<the id you just passed>, body="...") reaches them. Do NOT open your own thread for the same work; that is a duplicate room, not a way in.`,
    );
    if (refused) return refused;
    throw e;
  }
  return ok(
    [
      `Added ${resolved.label} to thread \`${participant.threadId}\` in **${chName}** — that thread is now a BREAKOUT ROOM, and its participant set is who may post into it.`,
      resolved.ref.kind === "agent"
        ? `The agent still acts only when ADDRESSED: post into the thread with thread="${participant.threadId}" and to_agent="<handle>". And when that agent POSTS into this thread it must name itself — as_agent="<its handle>" — because the server checks the set against the agent a post CLAIMS; without it the post is refused.`
        : // B3 — ADMITTING NOBODY IS TOLD. `joinThreadParticipant` inserts one
          // row and posts nothing, and `channel_task_participants` is
          // deliberately NOT in the realtime publication, so there is no
          // message, no notification and no push on any surface. This line used
          // to claim "admitting a PERSON notifies them", which is the same
          // class of false promise as the escalation rule it echoed.
          `Admitting a PERSON notifies NOBODY: this writes one row and sends no message, and nothing pushes it to them. It never spawns their agent either. If they need to know, TELL them — dopl_channel(op="post", channel="${ch.id}", thread="${participant.threadId}", to="<them>", body="..."). Address an agent by handle when you need one to act.`,
    ].join("\n"),
  );
}

/** Remove an identity from a thread's participant set. Idempotent. */
export async function opLeaveThread(
  client: DoplClient,
  channelRef: string,
  threadId: string,
  who: ParticipantArgs,
): Promise<ToolResponse> {
  const ch = await resolveChannelOr(client, channelRef);
  if (isErr(ch)) return ch;
  const chName = inlineOr(ch.name, NO_NAME);
  const resolved = await resolveParticipantOr(client, ch.id, who);
  if (isErr(resolved)) return resolved;
  try {
    await client.removeThreadParticipant(ch.id, threadId, resolved.ref);
  } catch (e) {
    const refused = participantWriteError(
      e,
      threadId,
      chName,
      "remove",
      // The EJECT rule, which is narrower than the curation rule on join.
      `You can't remove ${resolved.label} from thread ${inlineOr(threadId, NO_AGENT_ID)} — nothing changed, and you have NOT been removed from **${chName}**. You may always take YOURSELF out of a breakout room, or an agent you own; ejecting anyone else is the call of the member who opened the thread or the member it is addressed to. Ask one of them.`,
    );
    if (refused) return refused;
    throw e;
  }
  return ok(
    `Removed ${resolved.label} from thread ${inlineOr(threadId, NO_AGENT_ID)} in **${chName}**. Leaving is idempotent — this reads the same whether a row went away or there was none to remove.`,
  );
}

/** A resolved participant: the wire ref, and a render-safe label for it. */
interface ResolvedParticipant {
  ref: ThreadParticipantRef;
  /** ALREADY render-safe — splice it, do not neutralize it again. */
  label: string;
}

/**
 * Resolve the ONE identity a join/leave names. Exactly one of `member` /
 * `agent` — naming both is refused rather than silently preferring one, since
 * the two address different machines.
 */
async function resolveParticipantOr(
  client: DoplClient,
  channelId: string,
  who: ParticipantArgs,
): Promise<ResolvedParticipant | ToolResponse> {
  if (who.member && who.agent) {
    return err(
      `Pass either \`member\` (a person) or \`agent\` (a named agent), not both — they name different participants.`,
    );
  }
  if (who.agent) {
    const agent = await resolveAgentOr(client, channelId, who.agent);
    if (isErr(agent)) return agent;
    return { ref: { kind: "agent", id: agent.id }, label: agentLabel(agent) };
  }
  if (who.member) {
    const member = await resolveMemberOr(client, who.member);
    if (isErr(member)) return member;
    return { ref: { kind: "user", id: member.userId }, label: member.label };
  }
  return err(
    `Name who is joining or leaving: \`member\`=<email or user id> for a person, or \`agent\`=<handle or agent id> for an agent.`,
  );
}

/**
 * The refusals a participant write shares. Null when it is none of them.
 *
 * THE TWO 403s ARE NOT THE SAME REFUSAL, and mapping both onto "you are not a
 * member of that channel" was a lie with a scary shape: an agent refused by the
 * CURATION rule told its operator they had been removed from the room. The
 * routes raise `CHANNEL_FORBIDDEN` for a caller outside the channel and
 * `TASK_FORBIDDEN` for a caller inside it who has no authority over THIS
 * THREAD (service-participants.ts), so the code is read rather than guessed —
 * the same doctrine as the 400 mapping. `curation` is the thread-authorization
 * arm, and it differs per op (admitting is curated by three parties, ejecting
 * by two), so the caller passes the one that fits.
 */
function participantWriteError(
  e: unknown,
  threadId: string,
  safeChannelName: string,
  verb: string,
  curation: string,
): ToolResponse | null {
  if (isNotFound(e)) {
    return err(
      `No thread ${inlineOr(threadId, NO_AGENT_ID)} in **${safeChannelName}**. List them with op="list_threads".`,
    );
  }
  if (isForbidden(e)) {
    switch (classifyForbidden(e)) {
      case "thread_authorization":
        return err(curation);
      case "not_a_member":
        return err(
          `You can't ${verb} participants in **${safeChannelName}** — you are not a member of that channel. Nothing changed.`,
        );
      default:
        // NOT "you are not a member": an uncoded 403 on a thread route is far
        // more likely to be a thread rule than a channel one, and telling an
        // agent it left the room is the failure this switch exists to end.
        return err(
          `The server refused to ${verb} that participant (HTTP 403) and did not name a cause this tool recognizes.${serverDetail(e)} Nothing changed — check the thread with op="get_thread" before retrying.`,
        );
    }
  }
  if (isBadRequest(e)) {
    return err(
      `That participant change was rejected.${serverDetail(e)} A participant must already belong to the channel: a person as a MEMBER, an agent as an agent OF THIS CHANNEL. Nothing changed.`,
    );
  }
  return null;
}
