import "server-only";
import type { ChannelThread, ThreadMode } from "../types";
import type { TaskCreateInput } from "../schema";
import {
  ChannelAddresseeNotMemberError,
  TaskForbiddenError,
  TaskNotFoundError,
  TaskSelfTargetError,
} from "./errors";
import type { ChannelTaskRow } from "./dto";
import { mapTaskRow } from "./dto";
import * as repo from "./repository";
import * as repoTasks from "./repository-tasks";
import { postMessage } from "./service-writes";
import {
  requireMemberChannel,
  stripNulDeep,
  UNIQUE_VIOLATION,
  type ChannelContext,
} from "./service-shared";

/**
 * First-class channel threads: CREATE and SET MODE. Transcript rides on
 * `postMessage`. The rest of the lifecycle:
 *   - `service-tasks-lifecycle.ts` — CLOSE and REOPEN, the two writes that move
 *     `status`, sharing a guard-then-echo shape.
 *   - `service-tasks-propose.ts` — PROPOSE a close (mutates nothing).
 *
 * ⚠ Server boundary: wire/storage name `task` == domain name `thread`. This lane
 * is STORAGE side and keeps the `task` spelling throughout, but returns
 * {@link ChannelThread} values — everything a human or agent reads says
 * `thread`.
 */

/**
 * The initiating request's idempotency key, derived from the task id. ⚠ The task
 * row and its opening message are two writes with NO transaction around them, so
 * this key is what makes the PAIR converge — whichever attempt gets there posts,
 * every later one dedups on `channel_messages_client_msg_author_key`
 * (`20260822120000`, which widened that index to include the author).
 *
 * ⚠ THE WIDENING IS INVISIBLE TO THIS KEY AND THAT IS NOT LUCK. Only the thread's
 * CREATOR ever reaches this post — the thread probe is author-scoped too
 * (`repository-tasks.ts › findOwnTaskByClientId`, 2026-09-02), so every writer of
 * `task-open-<taskId>` for a given task is the same user by construction and the
 * message dedup still fires.
 */
function openingMessageClientId(taskId: string): string {
  return `task-open-${taskId}`;
}

/**
 * Post (or re-post) a task's initiating request — EXACTLY ONCE per task, on
 * every path that returns that task.
 *
 * ⚠ Insert-then-post as separate unguarded steps loses the request permanently:
 * if the insert lands and the post throws, the retry hits the `client_msg_id`
 * short-circuit, returns the stored task and NEVER posts, leaving a thread in
 * the panel with no message for the responder's desktop to route.
 *
 * ⚠ Both writes stay in the SAME idempotency envelope rather than moving into
 * one RPC — `postMessage` owns the addressee check, the reserved-key strip and
 * the task-key stamping, and forking that into PL/pgSQL gives the metadata
 * contract two homes. So the message gets its own deterministic key and the post
 * is re-driven on every create path.
 *
 * ⚠ Fields come from the STORED task row, never the retry's input, so a re-send
 * cannot rewrite the title or re-address the request.
 */
async function postOpeningMessage(
  ctx: ChannelContext,
  channelId: string,
  task: { id: string; title: string; target_user_id: string | null },
  body: string,
  // Spawn-with-handoff: the opener carries the reserved `metadata.handoff` stamp
  // so the OPERATOR'S desktop opens the requester session instead of the
  // external session that posted the create. ⚠ Server-internal only.
  handoff?: boolean,
  // Request fan-out: the opener carries the reserved `metadata.fanoutGroup`
  // stamp so the N threads of ONE request render as ONE card. ⚠ Server-internal
  // only — {@link TaskCreateOptions}.
  fanoutGroupId?: string
): Promise<number> {
  const message = await postMessage(
    ctx,
    channelId,
    {
      body,
      kind: "message",
      toUserId: task.target_user_id ?? undefined,
      summary: task.title,
      metadata: { taskId: task.id },
      clientMsgId: openingMessageClientId(task.id),
    },
    { handoff, fanoutGroupId }
  );
  // ⚠ Seq travels back out — it is the requester's `await` cursor and is only
  // known here. Every return path is idempotent, so a dedup'd re-post yields the
  // STORED message and the same seq, never a new one.
  return message.seq;
}

/**
 * What `createTask` hands back: the thread plus the seq of its opening message —
 * the cursor a requester passes straight to `dopl_channel(op="await")`.
 *
 * ⚠ Without it the requester must `read limit=1` to learn where to start
 * watching: an extra round-trip AND a race, since a peer answering between the
 * create and that read makes the "newest message" its reply, so the await starts
 * one message too late and waits forever for something already delivered.
 *
 * ⚠ `null` is kept on the type for the WIRE, not for this service: the route's
 * field is additive and an older deployment omits it
 * (`packages/dopl-client/src/channel.ts › createChannelThread`), so every reader
 * already handles the absence.
 */
export interface TaskCreateResult {
  thread: ChannelThread;
  openingSeq: number | null;
}

/**
 * Finish a create that landed on an EXISTING thread — the `client_msg_id`
 * short-circuit and the lost-insert race, the same situation reached two ways,
 * so they must answer IDENTICALLY.
 *
 * The caller always gets the STORED thread: not an error, not a second row, and
 * it re-drives the opening post (the repair for a create that half-landed).
 *
 * ⚠ THE THREAD IS ALWAYS THIS CALLER'S OWN, AND THAT IS ENFORCED, NOT ASSUMED —
 * `findOwnTaskByClientId` narrows by `created_by` and the unique index behind it
 * says the same (`20260913120000_channel_tasks_author_scoped_idempotency.sql`).
 * A colliding key from another member now yields a SEPARATE thread rather than
 * converging here, which is why this function no longer has a
 * somebody-else's-thread arm to take.
 */
async function convergeOnThread(
  ctx: ChannelContext,
  channelId: string,
  task: ChannelTaskRow,
  input: TaskCreateInput,
  opts: TaskCreateOptions
): Promise<TaskCreateResult> {
  const openingSeq = await postOpeningMessage(
    ctx,
    channelId,
    task,
    input.body,
    input.handoff,
    opts.fanoutGroupId
  );
  return { thread: mapTaskRow(task), openingSeq };
}

/**
 * SERVER-INTERNAL create options — not fields of {@link TaskCreateInput}, not
 * parsed by any route, and therefore unreachable from an HTTP caller. Same
 * device as `service-writes-metadata.ts › PostMetadataOptions`.
 *
 * ⚠ This parameter is ADDITIVE and changes nothing `createTask` decides: the
 * authorization, the addressee checks, the self-target refusal and the
 * idempotency short-circuit are untouched, and a thread is still ONE requester
 * plus ONE target (INVARIANTS §5). It exists so the fan-out — which is a
 * CALLER of `createTask`, never a second create path — can put its group id on
 * the opening message through the one function that posts it.
 */
export interface TaskCreateOptions {
  /** Stamped as reserved `metadata.fanoutGroup` on the opening message. */
  fanoutGroupId?: string;
}

/**
 * Create a first-class task. Caller must be a channel member; `toUserId` must be
 * a member of THAT channel AND an ACTIVE workspace member (a departed teammate
 * stays in `channel_members` but can never answer). `body` posts as the task's
 * first message, tagged `metadata.taskId`.
 *
 * ⚠ A thread is between its CREATOR and its TARGET, and that pair is the whole
 * write gate (`service-writes-metadata-thread.ts`).
 */
export async function createTask(
  ctx: ChannelContext,
  ref: string,
  rawInput: TaskCreateInput,
  opts: TaskCreateOptions = {}
): Promise<TaskCreateResult> {
  const input = stripNulDeep(rawInput);
  const { channel } = await requireMemberChannel(
    ctx,
    ref,
    "create a task in this channel"
  );
  // ⚠ Target must be a channel member AND an ACTIVE workspace member.
  // `channel_members` is never swept on workspace-leave, so a departed teammate
  // stays addressable: create succeeds, the opener posts, `openingSeq` returns,
  // the requester arms `await`, and nothing ever answers. Channel check first,
  // so the workspace round-trip is only paid for an actual channel member.
  if (
    !(
      (await repo.findMembership(channel.id, input.toUserId)) &&
      (await repo.isActiveWorkspaceMember(ctx.workspaceId, input.toUserId))
    )
  ) {
    throw new ChannelAddresseeNotMemberError(input.toUserId);
  }
  // ⚠ A thread addressed to its own creator is DEAD ON ARRIVAL — only creator
  // and target may post, and here they are one person. Closes the AGENT path
  // (`to` is whatever user id the model resolved); the web composer already
  // filters the caller out of its addressee list
  // (`components/channels-v2/composer.tsx`, off `indexMembers`).
  //
  // ⚠ SITS BEFORE THE IDEMPOTENCY SHORT-CIRCUIT ON PURPOSE. Behind it, a retry
  // with the same `client_msg_id` finds the stored dead thread and returns it as
  // a success — the caller is told it is fine exactly once it is unfixable.
  if (input.toUserId === ctx.userId) {
    throw new TaskSelfTargetError();
  }

  // A re-sent client_msg_id returns the caller's OWN already-created task WITHOUT
  // a second row — {@link convergeOnThread}, also the 23505 branch's answer so the
  // two ways of losing a race cannot drift apart. ⚠ The probe is author-scoped:
  // another member's row under the same key is not a hit here and never was
  // supposed to be.
  if (input.clientMsgId) {
    const existing = await repoTasks.findOwnTaskByClientId(
      channel.id,
      ctx.userId,
      input.clientMsgId
    );
    if (existing) return convergeOnThread(ctx, channel.id, existing, input, opts);
  }

  let task;
  try {
    task = await repoTasks.insertTask({
      channel_id: channel.id,
      workspace_id: ctx.workspaceId,
      title: input.title,
      mode: input.mode ?? "interactive",
      created_by: ctx.userId,
      target_user_id: input.toUserId,
      client_msg_id: input.clientMsgId ?? null,
    });
  } catch (err) {
    // Lost an idempotency race — converge on the stored winner. Re-driving the
    // post is safe (same derived key, so at most one message lands) and covers
    // the winner having crashed before posting.
    if (repo.pgErrorCode(err) === UNIQUE_VIOLATION && input.clientMsgId) {
      const raced = await repoTasks.findOwnTaskByClientId(
        channel.id,
        ctx.userId,
        input.clientMsgId
      );
      if (raced) return convergeOnThread(ctx, channel.id, raced, input, opts);
    }
    throw err;
  }

  const openingSeq = await postOpeningMessage(
    ctx,
    channel.id,
    task,
    input.body,
    input.handoff,
    opts.fanoutGroupId
  );

  return { thread: mapTaskRow(task), openingSeq };
}

/**
 * Change a task's mode. CREATOR ONLY — mode governs the creator's own machine.
 * ⚠ Posts NO message: deliberately realtime-invisible, since a mode is the
 * creator's machine's business, not a fact about the shared exchange. The two
 * writes that ARE facts about it (close, reopen) live in
 * `service-tasks-lifecycle.ts` and both echo.
 */
export async function setTaskMode(
  ctx: ChannelContext,
  ref: string,
  taskId: string,
  mode: ThreadMode
): Promise<ChannelThread> {
  const { channel } = await requireMemberChannel(
    ctx,
    ref,
    "change a task's mode in this channel"
  );
  const task = await repoTasks.findTaskByChannelAndId(channel.id, taskId);
  if (!task) throw new TaskNotFoundError(taskId);
  if (task.created_by !== ctx.userId) {
    throw new TaskForbiddenError("set the mode of this task");
  }

  const updated = await repoTasks.updateTask(task.id, { mode });
  return mapTaskRow(updated);
}
