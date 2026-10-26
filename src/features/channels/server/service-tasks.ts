import "server-only";
import type {
  ChannelTaskDetail,
  ChannelTaskPage,
  ChannelTaskWriteResult,
  TaskStatus,
} from "../types";
import type { TaskActionInput, TaskActionOf } from "../schema-tasks";
import { CHANNEL_TASK_LIST_LIMIT } from "../constants";
import { TaskLinkUnresolvedError } from "./errors";
import { mapTaskRow } from "./dto-tasks";
import * as repoMessages from "./repository-messages";
import * as repoTasks from "./repository-tasks";
import * as repoThreads from "./repository-threads";
import { insertOrConverge } from "./service-mailbox-idempotency";
import { loadVisibleChannel, type ChannelContext } from "./service-shared";
import { assertAssignable, assignActor, assignTask, unassignTask } from "./service-tasks-assign";
import { addNote, addSubtask, updateSubtask } from "./service-tasks-children";
import {
  callerActor,
  loadTaskRow,
  readTaskDetail,
  requireTaskEditor,
  resolveTaskActor,
  taskResult,
  type TaskActorIds,
} from "./service-tasks-shared";

/**
 * Channel tasks (PLAN.md R5–R10). Reads need channel visibility; writes need membership, and a
 * guest may only add notes (`service-tasks-shared.ts`). There is no delete (R10). Status moves
 * through `set_status` alone (R5).
 */

export async function listChannelTasks(
  ctx: ChannelContext,
  ref: string,
  status: TaskStatus | null
): Promise<ChannelTaskPage> {
  const { channel } = await loadVisibleChannel(ctx, ref);
  const rows = await repoTasks.listTasks(channel.id, status, CHANNEL_TASK_LIST_LIMIT);
  return { tasks: rows.map(mapTaskRow), truncated: rows.length >= CHANNEL_TASK_LIST_LIMIT };
}

export async function readChannelTask(
  ctx: ChannelContext,
  ref: string,
  taskId: string
): Promise<ChannelTaskDetail> {
  const { channel } = await loadVisibleChannel(ctx, ref);
  return readTaskDetail(channel.id, taskId);
}

/** The thread or message (by `seq`) the task came from; it must be in this channel. */
async function resolveLink(
  channelId: string,
  input: TaskActionOf<"create">
): Promise<{ linked_thread_id: string | null; linked_message_id: string | null }> {
  if (input.thread !== undefined) {
    const thread = await repoThreads.findThreadByChannelAndId(channelId, input.thread);
    if (!thread) throw new TaskLinkUnresolvedError(`thread ${input.thread}`);
    return { linked_thread_id: thread.id, linked_message_id: null };
  }
  if (input.message !== undefined) {
    const [message] = await repoMessages.findMessageRefsBySeqs(channelId, [input.message]);
    if (!message) throw new TaskLinkUnresolvedError(`message #${input.message}`);
    return { linked_thread_id: null, linked_message_id: message.id };
  }
  return { linked_thread_id: null, linked_message_id: null };
}

/** Idempotent on `clientMsgId`, author-scoped: a retry returns the caller's first task as it is now. */
export async function createTask(
  ctx: ChannelContext,
  ref: string,
  input: TaskActionOf<"create">
): Promise<ChannelTaskWriteResult> {
  const { channel } = await requireTaskEditor(ctx, ref);
  const clientMsgId = input.clientMsgId ?? null;
  if (clientMsgId) {
    const existing = await repoTasks.findOwnTaskIdByClientId(channel.id, ctx.userId, clientMsgId);
    if (existing) return taskResult(channel.id, existing);
  }
  const assignees: TaskActorIds[] = [];
  for (const assigneeRef of input.assignees ?? []) {
    const actor = await resolveTaskActor(ctx, channel.id, assigneeRef);
    assertAssignable(ctx, actor);
    if (!assignees.some((a) => a.userId === actor.userId && a.agentId === actor.agentId)) {
      assignees.push(actor);
    }
  }
  const link = await resolveLink(channel.id, input);
  const creator = callerActor(ctx);
  const { row: taskId, existing } = await insertOrConverge({
    clientMsgId,
    insert: () =>
      repoTasks.insertTask({
        channel_id: channel.id,
        workspace_id: channel.workspace_id,
        title: input.title,
        description: input.description ?? "",
        created_by: creator.userId,
        created_by_agent: creator.agentId,
        ...link,
        due_at: input.dueAt ?? null,
        client_msg_id: clientMsgId,
      }),
    find: (key) => repoTasks.findOwnTaskIdByClientId(channel.id, ctx.userId, key),
  });
  if (!existing) {
    for (const [i, actor] of assignees.entries()) {
      await assignActor(ctx, channel.id, { id: taskId, title: input.title, assigneeCount: i }, actor);
    }
  }
  return taskResult(channel.id, taskId);
}

export async function updateTask(
  ctx: ChannelContext,
  ref: string,
  input: TaskActionOf<"update">
): Promise<ChannelTaskWriteResult> {
  const { channel } = await requireTaskEditor(ctx, ref);
  const row = await loadTaskRow(channel.id, input.task);
  await repoTasks.updateTask(channel.id, row.id, {
    ...(input.title !== undefined && { title: input.title }),
    ...(input.description !== undefined && { description: input.description }),
    ...(input.dueAt !== undefined && { due_at: input.dueAt }),
  });
  return taskResult(channel.id, row.id);
}

/** The one status write (R5). Resolving stamps who and when; any other status clears both. */
export async function setTaskStatus(
  ctx: ChannelContext,
  ref: string,
  input: TaskActionOf<"set_status">
): Promise<ChannelTaskWriteResult> {
  const { channel } = await requireTaskEditor(ctx, ref);
  const row = await loadTaskRow(channel.id, input.task);
  if (row.status !== input.status) {
    const resolver = input.status === "resolved" ? callerActor(ctx) : null;
    await repoTasks.updateTask(channel.id, row.id, {
      status: input.status,
      resolved_at: resolver ? new Date().toISOString() : null,
      resolved_by: resolver?.userId ?? null,
      resolved_by_agent: resolver?.agentId ?? null,
    });
  }
  return taskResult(channel.id, row.id);
}

export function applyTaskAction(
  ctx: ChannelContext,
  ref: string,
  input: TaskActionInput
): Promise<ChannelTaskWriteResult> {
  switch (input.action) {
    case "create":
      return createTask(ctx, ref, input);
    case "update":
      return updateTask(ctx, ref, input);
    case "set_status":
      return setTaskStatus(ctx, ref, input);
    case "assign":
      return assignTask(ctx, ref, input);
    case "unassign":
      return unassignTask(ctx, ref, input);
    case "add_subtask":
      return addSubtask(ctx, ref, input);
    case "update_subtask":
      return updateSubtask(ctx, ref, input);
    case "add_note":
      return addNote(ctx, ref, input);
  }
}
