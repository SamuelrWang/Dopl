import "server-only";
import type { ChannelTaskWriteResult } from "../types";
import type { TaskActionOf } from "../schema-tasks";
import { CHANNEL_TASK_ASSIGNEE_MAX } from "../constants";
import { ChannelForbiddenError, TaskLimitError } from "./errors";
import * as repoTasks from "./repository-tasks";
import type { ChannelContext } from "./service-shared";
import { postMessage } from "./service-writes";
import {
  callerActor,
  loadTaskRow,
  requireTaskEditor,
  resolveTaskActor,
  taskResult,
  type TaskActorIds,
} from "./service-tasks-shared";

/**
 * An agent credential may only reach its own operator's agents (the same carve
 * `service-writes-metadata-recipient.ts › liveAgentHandles` enforces for `to=`), so it may not
 * assign a peer's agent: the wake below could not address it.
 */
export function assertAssignable(ctx: ChannelContext, actor: TaskActorIds): void {
  if (actor.agentId !== null && ctx.source === "agent" && actor.userId !== ctx.userId) {
    throw new ChannelForbiddenError("assign another member's agent");
  }
}

/**
 * Adds the assignee, and when it is an agent other than the caller, posts an ordinary addressed
 * message through the one post path so that agent wakes (R7). An existing assignment posts nothing.
 */
export async function assignActor(
  ctx: ChannelContext,
  channelId: string,
  task: { id: string; title: string; assigneeCount: number },
  actor: TaskActorIds
): Promise<void> {
  if (task.assigneeCount >= CHANNEL_TASK_ASSIGNEE_MAX) {
    throw new TaskLimitError("assignees", CHANNEL_TASK_ASSIGNEE_MAX);
  }
  const rowId = await repoTasks.insertAssignee(task.id, actor.userId, actor.agentId);
  if (rowId === null || actor.agentId === null) return;
  if (actor.agentId === callerActor(ctx).agentId) return;
  await postMessage(
    ctx,
    channelId,
    {
      body: `Task assigned to you: ${task.title}`,
      to: `@agent-${actor.agentId}`,
      clientMsgId: `task-${task.id}-assign-${rowId}`,
    },
    { taskId: task.id }
  );
}

export async function assignTask(
  ctx: ChannelContext,
  ref: string,
  input: TaskActionOf<"assign">
): Promise<ChannelTaskWriteResult> {
  const { channel } = await requireTaskEditor(ctx, ref);
  const row = await loadTaskRow(channel.id, input.task);
  const actor = await resolveTaskActor(ctx, channel.id, input.assignee);
  assertAssignable(ctx, actor);
  await assignActor(
    ctx,
    channel.id,
    { id: row.id, title: row.title, assigneeCount: row.channel_task_assignees?.length ?? 0 },
    actor
  );
  return taskResult(channel.id, row.id);
}

/** Needs no live session: an ended agent is matched by its id and can still be taken off. */
export async function unassignTask(
  ctx: ChannelContext,
  ref: string,
  input: TaskActionOf<"unassign">
): Promise<ChannelTaskWriteResult> {
  const { channel } = await requireTaskEditor(ctx, ref);
  const row = await loadTaskRow(channel.id, input.task);
  await repoTasks.deleteAssignee(
    row.id,
    input.assignee.kind === "person"
      ? { userId: input.assignee.userId, agentId: null }
      : { agentId: input.assignee.agentId }
  );
  return taskResult(channel.id, row.id);
}
