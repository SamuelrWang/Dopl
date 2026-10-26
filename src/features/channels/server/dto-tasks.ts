import type {
  ChannelTask,
  ChannelTaskDetail,
  ChannelTaskNote,
  ChannelTaskSubtask,
  SubtaskState,
  TaskActor,
  TaskLink,
  TaskStatus,
} from "../types";

export type ChannelTaskRow = {
  id: string;
  channel_id: string;
  workspace_id: string;
  title: string;
  description: string;
  status: string;
  created_by: string;
  created_by_agent: string | null;
  linked_thread_id: string | null;
  linked_message_id: string | null;
  due_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  resolved_by_agent: string | null;
  client_msg_id: string | null;
  created_at: string;
  updated_at: string;
};

export type TaskAssigneeRow = {
  id: string;
  task_id: string;
  user_id: string;
  agent_id: string | null;
  created_at: string;
};

export type TaskSubtaskRow = {
  id: string;
  task_id: string;
  position: number;
  title: string;
  detail: string | null;
  owner_user_id: string | null;
  owner_agent_id: string | null;
  state: string;
  created_by: string | null;
  client_msg_id: string | null;
  created_at: string;
  updated_at: string;
};

export type TaskNoteRow = {
  id: string;
  task_id: string;
  author_user_id: string;
  author_agent_id: string | null;
  body: string;
  client_msg_id: string | null;
  created_at: string;
};

/** A task with the embeds {@link TASK_READ_COLS} selects. */
export type ChannelTaskReadRow = ChannelTaskRow & {
  channel_task_assignees: TaskAssigneeRow[] | null;
  channel_task_subtasks: TaskSubtaskRow[] | null;
  linked_thread: { title: string } | null;
  linked_message: { seq: number | string } | null;
};

/** Each embed is bounded by the service's caps (`CHANNEL_TASK_SUBTASK_MAX`, `CHANNEL_TASK_ASSIGNEE_MAX`). */
export const TASK_READ_COLS =
  "*, channel_task_assignees(*), channel_task_subtasks(*), " +
  "linked_thread:channel_threads!channel_tasks_linked_thread_id_fkey(title), " +
  "linked_message:channel_messages!channel_tasks_linked_message_id_fkey(seq)";

export function actorOf(userId: string, agentId: string | null): TaskActor;
export function actorOf(userId: string | null, agentId: string | null): TaskActor | null;
export function actorOf(userId: string | null, agentId: string | null): TaskActor | null {
  if (userId === null) return null;
  return agentId === null ? { kind: "person", userId } : { kind: "agent", userId, agentId };
}

const actorKey = (a: TaskActor) => (a.kind === "agent" ? `a:${a.agentId}` : `p:${a.userId}`);

function byPosition(a: TaskSubtaskRow, b: TaskSubtaskRow): number {
  return a.position - b.position || a.created_at.localeCompare(b.created_at);
}

function mapSubtask(row: TaskSubtaskRow): ChannelTaskSubtask {
  return {
    id: row.id,
    title: row.title,
    detail: row.detail,
    owner: actorOf(row.owner_user_id, row.owner_agent_id),
    state: row.state as SubtaskState,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function linkOf(row: ChannelTaskReadRow): TaskLink | null {
  if (row.linked_thread_id !== null && row.linked_thread !== null) {
    return { kind: "thread", threadId: row.linked_thread_id, title: row.linked_thread.title };
  }
  if (row.linked_message_id !== null && row.linked_message !== null) {
    return { kind: "message", messageId: row.linked_message_id, seq: Number(row.linked_message.seq) };
  }
  return null;
}

function activeOf(subtasks: readonly ChannelTaskSubtask[]): TaskActor[] {
  const seen = new Set<string>();
  const out: TaskActor[] = [];
  for (const s of subtasks) {
    if (s.state !== "in_progress" || s.owner === null) continue;
    const key = actorKey(s.owner);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s.owner);
  }
  return out;
}

function mapTaskWith(row: ChannelTaskReadRow, subtasks: ChannelTaskSubtask[]): ChannelTask {
  const assignees = [...(row.channel_task_assignees ?? [])]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((a) => actorOf(a.user_id, a.agent_id));
  return {
    id: row.id,
    channelId: row.channel_id,
    workspaceId: row.workspace_id,
    title: row.title,
    description: row.description,
    status: row.status as TaskStatus,
    createdBy: actorOf(row.created_by, row.created_by_agent),
    assignees,
    link: linkOf(row),
    dueAt: row.due_at,
    progress:
      subtasks.length === 0
        ? null
        : { done: subtasks.filter((s) => s.state === "done").length, total: subtasks.length },
    active: activeOf(subtasks),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
    resolvedBy: actorOf(row.resolved_by, row.resolved_by_agent),
  };
}

function sortedSubtasks(row: ChannelTaskReadRow): ChannelTaskSubtask[] {
  return [...(row.channel_task_subtasks ?? [])].sort(byPosition).map(mapSubtask);
}

export function mapTaskRow(row: ChannelTaskReadRow): ChannelTask {
  return mapTaskWith(row, sortedSubtasks(row));
}

/** `notes` newest first, as the repository reads them; the DTO is oldest first. */
export function mapTaskDetail(
  row: ChannelTaskReadRow,
  notes: readonly TaskNoteRow[],
  notesTruncated: boolean
): ChannelTaskDetail {
  const subtasks = sortedSubtasks(row);
  return {
    ...mapTaskWith(row, subtasks),
    subtasks,
    notes: [...notes].reverse().map(mapNote),
    notesTruncated,
  };
}

function mapNote(row: TaskNoteRow): ChannelTaskNote {
  return {
    id: row.id,
    author: actorOf(row.author_user_id, row.author_agent_id),
    body: row.body,
    createdAt: row.created_at,
  };
}
