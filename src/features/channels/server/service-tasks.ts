import "server-only";
import type { ChannelTask, TaskMode, TaskOutcome } from "../types";
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
 * First-class channel tasks (v15): create / close / set mode / reopen. Split
 * out of `service-writes.ts` (§2 cap) — a task is its own lifecycle with its
 * own authorization rules (creator vs. target), and its transcript rides on
 * `postMessage` from the message lane.
 */

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
): Promise<ChannelTask> {
  const input = stripNulDeep(rawInput);
  const { channel, membership } = await loadVisibleChannel(ctx, ref);
  if (!membership) {
    throw new ChannelForbiddenError("create a task in this channel");
  }
  if (!(await repo.findMembership(channel.id, input.toUserId))) {
    throw new ChannelAddresseeNotMemberError(input.toUserId);
  }

  // Idempotency: a re-sent client_msg_id returns the already-created task
  // WITHOUT inserting a second row or re-posting the initial request (which
  // would double-spawn the responder's session window). Mirrors the message
  // post's idempotency (findMessageByClientId → return the stored row).
  if (input.clientMsgId) {
    const existing = await repoTasks.findTaskByClientId(
      channel.id,
      input.clientMsgId
    );
    if (existing) return mapTaskRow(existing);
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
    // Lost an idempotency race — converge on the stored winner (again, no
    // re-post: the winning insert's own call posts the initial request).
    if (repo.pgErrorCode(err) === UNIQUE_VIOLATION && input.clientMsgId) {
      const raced = await repoTasks.findTaskByClientId(
        channel.id,
        input.clientMsgId
      );
      if (raced) return mapTaskRow(raced);
    }
    throw err;
  }

  await postMessage(ctx, channel.id, {
    body: input.body,
    kind: "message",
    toUserId: input.toUserId,
    summary: input.title,
    metadata: { taskId: task.id },
  });

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
  outcome: TaskOutcome,
  summary?: string
): Promise<ChannelTask> {
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
  mode: TaskMode
): Promise<ChannelTask> {
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
): Promise<ChannelTask> {
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
