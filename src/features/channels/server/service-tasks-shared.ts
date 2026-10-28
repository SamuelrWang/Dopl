import "server-only";
import type { ChannelTaskDetail, ChannelTaskWriteResult } from "../types";
import type { TaskActorRefInput } from "../schema-tasks";
import { CHANNEL_TASK_NOTE_READ_LIMIT } from "../constants";
import { authorAgentIdOf } from "../lib/agent-post-stamp";
import { ChannelForbiddenError, TaskActorUnresolvedError, TaskNotFoundError } from "./errors";
import { mapTaskDetail, type ChannelTaskReadRow } from "./dto-tasks";
import type { ChannelMemberRow, ChannelRow } from "./dto";
import * as repo from "./repository";
import * as repoSessions from "./repository-sessions";
import * as repoTasks from "./repository-tasks";
import { requireMemberChannel, type ChannelContext } from "./service-shared";

/** A stored actor: a person, or one of that person's agents. */
export type TaskActorIds = { userId: string; agentId: string | null };

/** The caller as an actor. The agent id comes from the server-stamped session key, never the body. */
export function callerActor(ctx: ChannelContext): TaskActorIds {
  const agentId =
    ctx.source === "agent"
      ? authorAgentIdOf({ metadata: { session_id: ctx.sessionId ?? null } })
      : null;
  return { userId: ctx.userId, agentId };
}

const TASK_WRITE_ACTION = "change tasks in this channel";

/** Notes: any channel member, guests included (R8). */
export function requireTaskMember(
  ctx: ChannelContext,
  ref: string
): Promise<{ channel: ChannelRow; membership: ChannelMemberRow }> {
  return requireMemberChannel(ctx, ref, TASK_WRITE_ACTION);
}

/** Every other write: a channel member who is not a guest (R8). */
export async function requireTaskEditor(
  ctx: ChannelContext,
  ref: string
): Promise<{ channel: ChannelRow; membership: ChannelMemberRow }> {
  const gate = await requireTaskMember(ctx, ref);
  if (ctx.role === "guest") throw new ChannelForbiddenError("change tasks as a guest");
  return gate;
}

export async function loadTaskRow(channelId: string, taskId: string): Promise<ChannelTaskReadRow> {
  const row = await repoTasks.findTask(channelId, taskId);
  if (!row) throw new TaskNotFoundError(taskId);
  return row;
}

export async function readTaskDetail(channelId: string, taskId: string): Promise<ChannelTaskDetail> {
  const [row, notes] = await Promise.all([
    loadTaskRow(channelId, taskId),
    repoTasks.listNotes(taskId, CHANNEL_TASK_NOTE_READ_LIMIT + 1),
  ]);
  return mapTaskDetail(
    row,
    notes.slice(0, CHANNEL_TASK_NOTE_READ_LIMIT),
    notes.length > CHANNEL_TASK_NOTE_READ_LIMIT
  );
}

export async function taskResult(channelId: string, taskId: string): Promise<ChannelTaskWriteResult> {
  return { task: await readTaskDetail(channelId, taskId) };
}

/**
 * A person must be a member of this channel; an agent must have a session here, and its operator
 * is read off that session rather than taken from the caller.
 */
export async function resolveTaskActor(
  ctx: ChannelContext,
  channelId: string,
  ref: TaskActorRefInput
): Promise<TaskActorIds> {
  if (ref.kind === "person") {
    if (!(await repo.hasMembership(channelId, ref.userId))) {
      throw new TaskActorUnresolvedError(ref.userId);
    }
    return { userId: ref.userId, agentId: null };
  }
  const rows = await repoSessions.sessionRowsWhere<{ user_id: string }>(
    (q) => q.eq("workspace_id", ctx.workspaceId).eq("channel_id", channelId).eq("name", ref.agentId),
    "user_id"
  );
  const userId = rows[0]?.user_id;
  if (!userId) throw new TaskActorUnresolvedError(`@agent-${ref.agentId}`);
  return { userId, agentId: ref.agentId };
}
