import "server-only";
import type { ChannelThread, ThreadMode } from "../types";
import type { TaskCreateInput } from "../schema";
import {
  ChannelAddresseeNotMemberError,
  ChannelForbiddenError,
  TaskForbiddenError,
  TaskNotFoundError,
  TaskSelfTargetError,
} from "./errors";
import type { ChannelTaskRow } from "./dto";
import { mapTaskRow } from "./dto";
import * as repo from "./repository";
import * as repoMessages from "./repository-messages";
import * as repoTasks from "./repository-tasks";
import { postMessage } from "./service-writes";
import {
  loadVisibleChannel,
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
 * every later one dedups on `channel_messages_client_msg_key`.
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
 * Seq of a thread's opening message as ALREADY STORED — a pure READ of the
 * derived key, NEVER a post. What a caller that converged on SOMEONE ELSE's
 * thread gets instead of a re-post.
 *
 * ⚠ Reading is safe where posting is not: the opening message is in a channel
 * the caller is a member of and would come back from an ordinary `read`. What
 * must not happen is the LOSER posting into the winner's thread.
 *
 * ⚠ `null` when there is genuinely no stored opening message (the winner crashed
 * between insert and post). Never a fabricated number.
 */
async function storedOpeningSeq(
  channelId: string,
  taskId: string
): Promise<number | null> {
  const stored = await repoMessages.findMessageByClientId(
    channelId,
    openingMessageClientId(taskId)
  );
  return stored?.seq ?? null;
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
 * `null` only when no opening message exists to name — see
 * {@link storedOpeningSeq}.
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
 * The caller always gets the STORED thread: not an error, not a second row.
 *
 * ⚠ What differs is what it may WRITE. The CREATOR re-drives its opening post
 * (the repair for a create that half-landed). ANYONE ELSE posts NOTHING and only
 * READS the stored opening seq — a colliding key from another member must not
 * put a message into their thread.
 */
async function convergeOnThread(
  ctx: ChannelContext,
  channelId: string,
  task: ChannelTaskRow,
  input: TaskCreateInput,
  opts: TaskCreateOptions
): Promise<TaskCreateResult> {
  const isCreator = task.created_by === ctx.userId;
  const openingSeq = isCreator
    ? await postOpeningMessage(
        ctx,
        channelId,
        task,
        input.body,
        input.handoff,
        opts.fanoutGroupId
      )
    : await storedOpeningSeq(channelId, task.id);
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
  const { channel, membership } = await loadVisibleChannel(ctx, ref);
  if (!membership) {
    throw new ChannelForbiddenError("create a task in this channel");
  }
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
  // filters the caller out of `components/address-picker.tsx`.
  //
  // ⚠ SITS BEFORE THE IDEMPOTENCY SHORT-CIRCUIT ON PURPOSE. Behind it, a retry
  // with the same `client_msg_id` finds the stored dead thread and returns it as
  // a success — the caller is told it is fine exactly once it is unfixable.
  if (input.toUserId === ctx.userId) {
    throw new TaskSelfTargetError();
  }

  // A re-sent client_msg_id returns the already-created task WITHOUT a second
  // row. Whether the caller may re-drive the opening post depends on whether it
  // IS the thread's creator — {@link convergeOnThread}, also the 23505 branch's
  // answer so the two ways of losing a race cannot drift apart.
  if (input.clientMsgId) {
    const existing = await repoTasks.findTaskByClientId(
      channel.id,
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
      const raced = await repoTasks.findTaskByClientId(
        channel.id,
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
  const { channel, membership } = await loadVisibleChannel(ctx, ref);
  if (!membership) {
    throw new ChannelForbiddenError("change a task's mode in this channel");
  }
  const task = await repoTasks.findTaskByChannelAndId(channel.id, taskId);
  if (!task) throw new TaskNotFoundError(taskId);
  if (task.created_by !== ctx.userId) {
    throw new TaskForbiddenError("set the mode of this task");
  }

  const updated = await repoTasks.updateTask(task.id, { mode });
  return mapTaskRow(updated);
}
