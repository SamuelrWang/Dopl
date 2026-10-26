import "server-only";
import type { ChannelTaskWriteResult } from "../types";
import type { TaskActionOf } from "../schema-tasks";
import { CHANNEL_TASK_SUBTASK_MAX } from "../constants";
import { SubtaskNotFoundError, TaskLimitError } from "./errors";
import * as repoTasks from "./repository-tasks";
import { insertOrConverge } from "./service-mailbox-idempotency";
import type { ChannelContext } from "./service-shared";
import {
  callerActor,
  loadTaskRow,
  requireTaskEditor,
  requireTaskMember,
  resolveTaskActor,
  taskResult,
} from "./service-tasks-shared";

/** Appends a subtask; the owner defaults to the caller. A retried `clientMsgId` adds nothing. */
export async function addSubtask(
  ctx: ChannelContext,
  ref: string,
  input: TaskActionOf<"add_subtask">
): Promise<ChannelTaskWriteResult> {
  const { channel } = await requireTaskEditor(ctx, ref);
  const row = await loadTaskRow(channel.id, input.task);
  const clientMsgId = input.clientMsgId ?? null;
  if (clientMsgId && (await repoTasks.findOwnSubtaskIdByClientId(row.id, ctx.userId, clientMsgId))) {
    return taskResult(channel.id, row.id);
  }
  const existing = row.channel_task_subtasks ?? [];
  if (existing.length >= CHANNEL_TASK_SUBTASK_MAX) {
    throw new TaskLimitError("subtasks", CHANNEL_TASK_SUBTASK_MAX);
  }
  const owner = input.owner ? await resolveTaskActor(ctx, channel.id, input.owner) : callerActor(ctx);
  await insertOrConverge({
    clientMsgId,
    insert: () =>
      repoTasks.insertSubtask({
        task_id: row.id,
        position: existing.reduce((max, s) => Math.max(max, s.position + 1), 0),
        title: input.title,
        detail: input.detail ?? null,
        owner_user_id: owner.userId,
        owner_agent_id: owner.agentId,
        created_by: ctx.userId,
        client_msg_id: clientMsgId,
      }),
    find: (key) => repoTasks.findOwnSubtaskIdByClientId(row.id, ctx.userId, key),
  });
  return taskResult(channel.id, row.id);
}

export async function updateSubtask(
  ctx: ChannelContext,
  ref: string,
  input: TaskActionOf<"update_subtask">
): Promise<ChannelTaskWriteResult> {
  const { channel } = await requireTaskEditor(ctx, ref);
  const row = await loadTaskRow(channel.id, input.task);
  const owner = input.owner ? await resolveTaskActor(ctx, channel.id, input.owner) : null;
  const matched = await repoTasks.updateSubtask(row.id, input.subtask, {
    ...(input.title !== undefined && { title: input.title }),
    ...(input.detail !== undefined && { detail: input.detail }),
    ...(input.state !== undefined && { state: input.state }),
    ...(owner && { owner_user_id: owner.userId, owner_agent_id: owner.agentId }),
  });
  if (!matched) throw new SubtaskNotFoundError(input.subtask);
  return taskResult(channel.id, row.id);
}

/** Append-only. Guests may add notes (R8). A retried `clientMsgId` adds nothing. */
export async function addNote(
  ctx: ChannelContext,
  ref: string,
  input: TaskActionOf<"add_note">
): Promise<ChannelTaskWriteResult> {
  const { channel } = await requireTaskMember(ctx, ref);
  const row = await loadTaskRow(channel.id, input.task);
  const clientMsgId = input.clientMsgId ?? null;
  if (clientMsgId && (await repoTasks.findOwnNoteIdByClientId(row.id, ctx.userId, clientMsgId))) {
    return taskResult(channel.id, row.id);
  }
  const author = callerActor(ctx);
  await insertOrConverge({
    clientMsgId,
    insert: () =>
      repoTasks.insertNote({
        task_id: row.id,
        author_user_id: author.userId,
        author_agent_id: author.agentId,
        body: input.body,
        client_msg_id: clientMsgId,
      }),
    find: (key) => repoTasks.findOwnNoteIdByClientId(row.id, ctx.userId, key),
  });
  return taskResult(channel.id, row.id);
}
