import "server-only";
import type { ChannelThread, ThreadMode, ThreadOutcome } from "../types";
import type { TaskCreateInput } from "../schema";
import {
  ChannelAddresseeNotMemberError,
  ChannelForbiddenError,
  TaskForbiddenError,
  TaskNotFoundError,
} from "./errors";
import { mapTaskRow } from "./dto";
import * as repo from "./repository";
import * as repoTasks from "./repository-tasks";
import { postMessage } from "./service-writes";
import {
  loadVisibleChannel,
  stripNulDeep,
  UNIQUE_VIOLATION,
  type ChannelContext,
} from "./service-shared";

/**
 * First-class channel threads (v15): create / close / set mode / reopen. Split
 * out of `service-writes.ts` (§2 cap) — a thread is its own lifecycle with its
 * own authorization rules (creator vs. target), and its transcript rides on
 * `postMessage` from the message lane.
 *
 * THE SERVER BOUNDARY: wire/storage name `task` == domain name `thread`. This
 * lane sits on the STORAGE side, so it deliberately keeps the `task` spelling
 * throughout — the `channel_tasks` table and its columns, `metadata.taskId`,
 * the request schemas, the error codes, and the `/tasks` route paths. It
 * returns {@link ChannelThread} values, and everything a human or an agent
 * reads (the web UI, the `dopl_channel` MCP ops) says `thread`.
 */

/**
 * The initiating request's idempotency key, derived from the task id. The task
 * row and its opening message are two writes with no transaction around them,
 * so the key is what makes the PAIR converge: whichever attempt gets there
 * posts, every later one dedups on `channel_messages_client_msg_key`. See
 * {@link postOpeningMessage}.
 */
function openingMessageClientId(taskId: string): string {
  return `task-open-${taskId}`;
}

/**
 * Post (or re-post) a task's initiating request — EXACTLY ONCE per task, on
 * every path that returns that task.
 *
 * Why this exists: `create_task` used to insert the row and then post the
 * request as a separate, unguarded step. If the insert landed and the post
 * threw (a transient DB error, an addressee removed mid-flight, a CHECK
 * failure), the retry hit the `client_msg_id` short-circuit, returned the
 * stored task and NEVER posted — leaving a thread that exists in the panel
 * with no message for the responder's desktop to route, so no session ever
 * spawned. The idempotency key permanently swallowed the request.
 *
 * The fix keeps both writes in the SAME idempotency envelope instead of
 * moving them into one RPC: `postMessage` owns the addressee check, the DM
 * auto-address, the reserved-key strip and the task-key stamping, and forking
 * that logic into PL/pgSQL would give the metadata contract two homes. So the
 * message gets its own deterministic key (`task-open-<taskId>`), the post is
 * re-driven on every create path, and `postMessage`'s own idempotency
 * (findMessageByClientId → the unique index) collapses the repeats.
 *
 * Fields come from the STORED task row, never the retry's input, so a re-send
 * cannot rewrite the title or re-address the request.
 */
async function postOpeningMessage(
  ctx: ChannelContext,
  channelId: string,
  task: { id: string; title: string; target_user_id: string | null },
  body: string
): Promise<void> {
  await postMessage(ctx, channelId, {
    body,
    kind: "message",
    toUserId: task.target_user_id ?? undefined,
    summary: task.title,
    metadata: { taskId: task.id },
    clientMsgId: openingMessageClientId(task.id),
  });
}

/**
 * Create a first-class task in a channel. The caller must be a channel member
 * and `toUserId` (the responder the task is addressed to) must be an active
 * member of THAT channel. The requester's initial request (`body`) is posted
 * as the task's first message, tagged `metadata.taskId` so it groups into the
 * task card and the server stamps the reserved task keys onto it.
 */
export async function createTask(
  ctx: ChannelContext,
  ref: string,
  rawInput: TaskCreateInput
): Promise<ChannelThread> {
  const input = stripNulDeep(rawInput);
  const { channel, membership } = await loadVisibleChannel(ctx, ref);
  if (!membership) {
    throw new ChannelForbiddenError("create a task in this channel");
  }
  if (!(await repo.findMembership(channel.id, input.toUserId))) {
    throw new ChannelAddresseeNotMemberError(input.toUserId);
  }

  // Idempotency: a re-sent client_msg_id returns the already-created task
  // WITHOUT inserting a second row. It still re-drives the initiating post —
  // which is a no-op when that message already landed (its own key dedups) and
  // the repair when it did not, so a retry can never leave a thread with no
  // request in it. Restricted to the task's own creator: a colliding key from
  // another member must not put a message into their thread (the post would be
  // refused anyway, turning a benign dedup into a 403).
  if (input.clientMsgId) {
    const existing = await repoTasks.findTaskByClientId(
      channel.id,
      input.clientMsgId
    );
    if (existing) {
      if (existing.created_by === ctx.userId) {
        await postOpeningMessage(ctx, channel.id, existing, input.body);
      }
      return mapTaskRow(existing);
    }
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
    // post here is safe (same derived key as the winner's own call, so at most
    // one message lands) and covers the winner having crashed before posting.
    if (repo.pgErrorCode(err) === UNIQUE_VIOLATION && input.clientMsgId) {
      const raced = await repoTasks.findTaskByClientId(
        channel.id,
        input.clientMsgId
      );
      if (raced) {
        if (raced.created_by === ctx.userId) {
          await postOpeningMessage(ctx, channel.id, raced, input.body);
        }
        return mapTaskRow(raced);
      }
    }
    throw err;
  }

  await postOpeningMessage(ctx, channel.id, task, input.body);

  return mapTaskRow(task);
}

/**
 * Close a task with an outcome. Permitted for the task's creator OR its target
 * (`created_by` / `target_user_id`). Posts a lifecycle marker so the other
 * member's thread updates live: completed -> `task_finished` (calm "done");
 * failed -> `task_failed` (a close with outcome=failed IS a genuine failure).
 */
export async function closeTask(
  ctx: ChannelContext,
  ref: string,
  taskId: string,
  outcome: ThreadOutcome,
  summary?: string
): Promise<ChannelThread> {
  const { channel, membership } = await loadVisibleChannel(ctx, ref);
  if (!membership) {
    throw new ChannelForbiddenError("close a task in this channel");
  }
  const task = await repoTasks.findTaskByChannelAndId(channel.id, taskId);
  if (!task) throw new TaskNotFoundError(taskId);
  if (task.created_by !== ctx.userId && task.target_user_id !== ctx.userId) {
    throw new TaskForbiddenError("close this task");
  }

  // A caller-supplied `summary` (a one-line outcome) is persisted on the task
  // row AND becomes the lifecycle echo's body; absent (or blank), the echo
  // keeps its calm default. The kind (task_finished/task_failed) is unchanged.
  const updated = await repoTasks.updateTask(task.id, {
    status: "closed",
    outcome,
    closed_at: new Date().toISOString(),
    // A blank/whitespace summary stores as null, not "" (render guards on null).
    outcome_summary: summary && summary.trim().length > 0 ? summary.trim() : null,
  });

  await postMessage(ctx, channel.id, {
    body:
      (summary && summary.trim()) ||
      (outcome === "completed" ? "Task completed" : "Task failed"),
    kind: outcome === "completed" ? "task_finished" : "task_failed",
    summary: task.title,
    metadata: { taskId: task.id },
  });

  return mapTaskRow(updated);
}

/**
 * Change a task's mode. CREATOR ONLY — the mode governs the creator's own
 * machine (interactive vs autonomous continuation). Posts NO message: the
 * change is intentionally realtime-invisible and the badge is eventually
 * consistent on the next tasks refetch.
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

/**
 * Reopen a closed task. WEB-ONLY (no MCP op — agents do not reopen). Permitted
 * for the task's creator OR its target (`created_by` / `target_user_id`),
 * mirroring {@link closeTask}'s authorization. Clears the closed state in a
 * single update — `status` back to `open`, and `outcome` / `closed_at` /
 * `outcome_summary` all nulled — which keeps the `closed ⇔ outcome` CHECK
 * satisfied ((status='closed') = (outcome IS NOT NULL)). Posts NO lifecycle
 * echo: the web overlay flips the card back to `active` on the next tasks
 * refetch, so no `task_*` marker is needed (and none would be coherent).
 */
export async function reopenTask(
  ctx: ChannelContext,
  ref: string,
  taskId: string
): Promise<ChannelThread> {
  const { channel, membership } = await loadVisibleChannel(ctx, ref);
  if (!membership) {
    throw new ChannelForbiddenError("reopen a task in this channel");
  }
  const task = await repoTasks.findTaskByChannelAndId(channel.id, taskId);
  if (!task) throw new TaskNotFoundError(taskId);
  if (task.created_by !== ctx.userId && task.target_user_id !== ctx.userId) {
    throw new TaskForbiddenError("reopen this task");
  }

  const updated = await repoTasks.updateTask(task.id, {
    status: "open",
    outcome: null,
    closed_at: null,
    outcome_summary: null,
  });
  return mapTaskRow(updated);
}
