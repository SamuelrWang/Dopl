import "server-only";
import type { ThreadParticipant } from "../types";
import type { ThreadParticipantRef } from "../schema";
import { mapParticipantRow } from "./agents-dto";
import {
  ChannelAgentNotInChannelError,
  ChannelForbiddenError,
  ChannelParticipantNotMemberError,
  TaskForbiddenError,
  TaskNotFoundError,
} from "./errors";
import type { ChannelTaskRow } from "./dto";
import * as repo from "./repository";
import * as repoAgents from "./repository-agents";
import * as repoParticipants from "./repository-participants";
import * as repoTasks from "./repository-tasks";
import {
  loadVisibleChannel,
  type ChannelContext,
} from "./service-shared";

/**
 * THREAD PARTICIPANTS — a breakout room's membership.
 *
 * A breakout room is a THREAD with a participant set, not a sub-channel: one
 * channel, one listener, one transcript, and a set of identities (humans and
 * agents) admitted to write into one exchange. This module owns who may be in
 * that set; `service-writes-metadata.ts` owns what the set then permits.
 *
 * THE GATES, and why they are these:
 *  - **Channel membership is a PRECONDITION, never the permission.** A
 *    participant set can only ever admit identities that can already read the
 *    room — admitting an outsider would create a writer who cannot see what
 *    they are writing into. But being able to read the room is not authority
 *    over one of its breakout rooms; see the curation rule below.
 *  - **THE CURATION RULE: only the thread's `created_by`, its
 *    `target_user_id`, or an existing USER participant may change the set.**
 *    Everyone else is a 403 ({@link TaskForbiddenError}), including a caller
 *    adding only themselves — a breakout room is invite-only, and drop-in join
 *    is a product decision nobody made.
 *
 *    WHY, concretely (the escalation this closes): the write gate in
 *    `service-writes-metadata.ts` (`mayWriteThread`) says a thread WITH a
 *    participant set is a breakout room whose SET decides who may post. Gating
 *    join on bare channel membership therefore let any member of a private
 *    channel {A,B,C} write themselves into A↔B's thread and, from there, post
 *    into it — including a `task_failed` carrying the calm-terminal flags
 *    (`declined`, `interrupted`, …), which re-stamps the outcome rendered on
 *    A's and B's cards. That is precisely the forgery the reserved-key strip
 *    and the legacy-id gate exist to prevent, reached through the front door.
 *    A thread with NO set is unaffected: its pair gate never consults this
 *    module. What changed is that "no set" is no longer something an outsider
 *    can end.
 *  - **AGENT OWNERSHIP DOES NOT CONFER CURATION.** Owning an agent that is in
 *    the set does not make its owner a curator, for the same reason
 *    `mayWriteThread` refuses to infer a human's write access from an agent
 *    they own: it would quietly widen a person's authority on the strength of
 *    a process they started. Only a `kind:"user"` row naming the caller counts.
 *  - **Ejecting is narrower than admitting.** Removing YOURSELF (or an agent
 *    you OWN) always works — nobody is held in a room. Removing anyone else is
 *    the thread's two original parties' call (`created_by` / `target_user_id`),
 *    not any participant's: admitting grows a room the admitter is already in,
 *    while ejecting takes something away from someone who was invited.
 *  - **An agent participant must belong to THIS channel.** An agent is summoned
 *    into a room and runs on its owner's machine; an agent from another room
 *    has no listener here and would be a participant nothing can reach.
 *  - **Leaving is idempotent.** Removing an identity that is not in the set is
 *    a no-op, not an error — the same shape `removeMember` uses, and the one
 *    that survives a retried "leave".
 *
 * NOT gated here: reading. Participant sets are visible to the whole channel,
 * the same way threads are (§8: breakouts separate attention, not visibility).
 */

/** What a join reports back: the row, and whether THIS call created it. */
export interface ParticipantJoinResult {
  participant: ThreadParticipant;
  created: boolean;
}

/** The one action string every curation refusal reports. */
const CURATE_ACTION = "change this thread's participants";

/**
 * Admit an identity to a thread. Idempotent: joining twice returns the row
 * already there with `created: false`, which the route turns into a 200 instead
 * of a 201.
 *
 * CURATION IS REQUIRED — creator, target, or an existing user participant (see
 * the module docblock). There is deliberately NO self-join exemption: "add only
 * myself" is the exact move the escalation used, so a non-curator naming
 * themselves is refused like any other non-curator.
 *
 * The 403 is raised BEFORE {@link assertIdentityBelongs}, so a caller with no
 * authority over the thread cannot use the 400/201 split to probe which user
 * ids are members of the channel or which agent ids live in it.
 *
 * `created` is decided by a pre-read, so under a concurrent double-join both
 * calls can report `created: true` for the one row the unique index actually
 * kept. That is the honest limit of a non-transactional check and it costs
 * nothing: the resource is the same either way, and no caller branches on the
 * status code beyond "it is in the set now".
 */
export async function joinThreadParticipant(
  ctx: ChannelContext,
  ref: string,
  taskId: string,
  identity: ThreadParticipantRef
): Promise<ParticipantJoinResult> {
  const { channelId, task } = await loadWritableThread(
    ctx,
    ref,
    taskId,
    CURATE_ACTION
  );
  if (!(await isThreadCurator(ctx, task))) {
    throw new TaskForbiddenError(CURATE_ACTION);
  }
  await assertIdentityBelongs(channelId, identity);

  const existing = await repoParticipants.findParticipant(
    task.id,
    identity.kind,
    identity.id
  );
  if (existing) {
    return { participant: mapParticipantRow(existing), created: false };
  }

  const row = await repoParticipants.insertParticipant(
    participantInsert(ctx, task, identity)
  );
  return { participant: mapParticipantRow(row), created: true };
}

/**
 * Remove an identity from a thread.
 *
 * LEAVING YOURSELF ALWAYS WORKS — yourself as a user, or an agent you own.
 * Nobody is held in a breakout room, and an owner shutting their own agent out
 * of one needs no permission from the room.
 *
 * EJECTING SOMEONE ELSE is the thread's two original parties' call: `created_by`
 * or `target_user_id`, not any participant. Narrower than the join rule on
 * purpose — admitting grows a room the admitter is already in, while ejecting
 * removes an invited collaborator, so it stays with the pair that owns the
 * exchange. Everyone else is a 403.
 *
 * Idempotency is unchanged: past the gate, removing an identity that is not in
 * the set is a no-op, so a retried leave never 404s.
 */
export async function leaveThreadParticipant(
  ctx: ChannelContext,
  ref: string,
  taskId: string,
  identity: ThreadParticipantRef
): Promise<void> {
  const { task } = await loadWritableThread(ctx, ref, taskId, CURATE_ACTION);
  if (!(await mayRemoveIdentity(ctx, task, identity))) {
    throw new TaskForbiddenError(CURATE_ACTION);
  }
  await repoParticipants.deleteParticipant(
    task.id,
    identity.kind,
    identity.id
  );
}

/**
 * Seed a NEW thread's participant set: its creator and its target as users,
 * then the caller's extras. Called from `createTask` only.
 *
 * IT ONLY RUNS WHEN THE CALLER ASKED FOR PARTICIPANTS. A thread created without
 * them gets NO rows at all, so the pair gate (`created_by`/`target_user_id`)
 * stays the whole rule for every ordinary thread — see
 * `service-writes-metadata.ts`. Seeding every thread would put two rows behind
 * every create for a set nobody uses, and would make "has participants" stop
 * meaning "is a breakout room". What keeps an un-seeded thread that way is the
 * CURATION RULE above, not this function: only someone already inside the
 * thread can ever add the first row.
 *
 * No curation check here — the caller IS `createTask`'s caller, who is the
 * thread's `created_by` and therefore a curator by definition.
 *
 * The creator and the target are added because they are the thread's two
 * original parties: a set that admitted a teammate's agent but not the person
 * who opened the thread would lock the author out of their own exchange the
 * moment the participant gate takes over.
 *
 * Best-effort per row is NOT the shape here — an invalid extra throws, and it
 * throws BEFORE any row is written, so a rejected create leaves no half-built
 * room. (The thread row itself already exists by then; that is
 * `createTask`'s known non-atomicity, F-070, not something this adds.)
 */
export async function seedThreadParticipants(
  ctx: ChannelContext,
  channelId: string,
  task: { id: string; workspace_id: string; created_by: string; target_user_id: string | null },
  extras: ThreadParticipantRef[]
): Promise<void> {
  const identities: ThreadParticipantRef[] = [
    { kind: "user", id: task.created_by },
  ];
  if (task.target_user_id) {
    identities.push({ kind: "user", id: task.target_user_id });
  }
  for (const extra of extras) {
    await assertIdentityBelongs(channelId, extra);
    identities.push(extra);
  }

  const seen = new Set<string>();
  for (const identity of identities) {
    const key = `${identity.kind}:${identity.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Idempotent at the repository (unique index + read-back), so a re-driven
    // create converges instead of erroring.
    await repoParticipants.insertParticipant(
      participantInsert(ctx, task, identity)
    );
  }
}

/** Every identity in a thread's set, oldest first (join order). */
export async function listThreadParticipants(
  taskId: string
): Promise<ThreadParticipant[]> {
  const rows = await repoParticipants.listParticipantsByTask(taskId);
  return rows.map(mapParticipantRow);
}

/**
 * Group participants for a page of threads, mapped and keyed by thread id.
 * Threads with no set map to `[]` — a legacy thread is not a thread with a
 * missing set, it is a thread whose set is empty, and the wire says so.
 */
export async function participantsByThread(
  taskIds: string[]
): Promise<Map<string, ThreadParticipant[]>> {
  const rows = await repoParticipants.listParticipantsByTasks(taskIds);
  const out = new Map<string, ThreadParticipant[]>();
  for (const taskId of taskIds) {
    out.set(taskId, (rows.get(taskId) ?? []).map(mapParticipantRow));
  }
  return out;
}

function participantInsert(
  ctx: ChannelContext,
  task: { id: string; workspace_id: string },
  identity: ThreadParticipantRef
): Parameters<typeof repoParticipants.insertParticipant>[0] {
  return {
    task_id: task.id,
    // From the THREAD row, never `ctx` — the denormalized column has a guard
    // trigger comparing it to the parent thread's, so the parent is the only
    // correct source.
    workspace_id: task.workspace_id,
    kind: identity.kind,
    user_id: identity.kind === "user" ? identity.id : null,
    agent_id: identity.kind === "agent" ? identity.id : null,
    added_by: ctx.userId,
  };
}

/**
 * THE CURATION RULE, in one function (see the module docblock for why).
 *
 * The thread's two original parties are curators unconditionally and without a
 * query — they are the pair the thread belongs to whether or not it ever grew
 * a set. Past them, the SET curates itself: an existing `kind:"user"` row
 * naming the caller. An agent row does NOT, even one the caller owns, so the
 * one read here also settles the agent case.
 *
 * The participant read is skipped entirely for creator/target, so the ordinary
 * two-party thread pays nothing for this gate.
 */
async function isThreadCurator(
  ctx: ChannelContext,
  task: ChannelTaskRow
): Promise<boolean> {
  if (task.created_by === ctx.userId) return true;
  if (task.target_user_id === ctx.userId) return true;
  const participants = await repoParticipants.listParticipantsByTask(task.id);
  return participants.some(
    (row) => row.kind === "user" && row.user_id === ctx.userId
  );
}

/**
 * May the caller remove THIS identity? Self-removal (themselves, or an agent
 * they own) always; anyone else only for the thread's creator or target.
 *
 * The ownership read is only reached for an agent, and only when the caller is
 * not already one of the two parties — a self-leave and a creator's eject both
 * answer without it.
 */
async function mayRemoveIdentity(
  ctx: ChannelContext,
  task: ChannelTaskRow,
  identity: ThreadParticipantRef
): Promise<boolean> {
  if (task.created_by === ctx.userId) return true;
  if (task.target_user_id === ctx.userId) return true;
  if (identity.kind === "user") return identity.id === ctx.userId;
  const agent = await repoAgents.findAgentById(identity.id);
  return agent?.owner_user_id === ctx.userId;
}

/**
 * Resolve a thread in a channel the caller may WRITE participants into: the
 * channel must be visible, the caller must be a member of it, and the thread
 * must belong to that channel (a foreign thread id collapses to 404 so it
 * cannot be probed across rooms).
 *
 * This is the PRECONDITION, not the permission — the curation rule
 * ({@link isThreadCurator} / {@link mayRemoveIdentity}) runs on top of it. A
 * channel member who is a stranger to the thread gets past here and is then
 * refused, which is what keeps a breakout room invite-only.
 */
async function loadWritableThread(
  ctx: ChannelContext,
  ref: string,
  taskId: string,
  action: string
): Promise<{ channelId: string; task: ChannelTaskRow }> {
  const { channel, membership } = await loadVisibleChannel(ctx, ref);
  if (!membership) throw new ChannelForbiddenError(action);
  const task = await repoTasks.findTaskByChannelAndId(channel.id, taskId);
  if (!task) throw new TaskNotFoundError(taskId);
  return { channelId: channel.id, task };
}

/**
 * A participant identity must already belong to the channel: a user as a
 * member, an agent as an agent OF THIS CHANNEL. Both refusals are 400s about
 * the address, not 403s about permission — the caller named something this room
 * cannot hold.
 */
async function assertIdentityBelongs(
  channelId: string,
  identity: ThreadParticipantRef
): Promise<void> {
  if (identity.kind === "user") {
    if (!(await repo.findMembership(channelId, identity.id))) {
      throw new ChannelParticipantNotMemberError(identity.id);
    }
    return;
  }
  const agent = await repoAgents.findAgentById(identity.id);
  if (!agent || agent.channel_id !== channelId) {
    throw new ChannelAgentNotInChannelError(identity.id);
  }
}
