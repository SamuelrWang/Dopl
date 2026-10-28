import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import {
  TASK_READ_COLS,
  type ChannelTaskReadRow,
  type ChannelTaskRow,
  type TaskNoteRow,
  type TaskSubtaskRow,
} from "./dto-tasks";

/**
 * Data access for `channel_tasks` and its three children (migration `20261121190000`). Admin
 * client throughout; the service is the fence. Every task read is scoped by `channel_id`, which is
 * what keeps a task id from being probed across rooms. Child reads follow a task already loaded
 * that way, so `task_id` is their scope.
 */

type TaskInsert = Pick<
  ChannelTaskRow,
  | "channel_id"
  | "workspace_id"
  | "title"
  | "description"
  | "created_by"
  | "created_by_agent"
  | "linked_thread_id"
  | "linked_message_id"
  | "due_at"
  | "client_msg_id"
>;

export type TaskPatch = Partial<
  Pick<
    ChannelTaskRow,
    "title" | "description" | "due_at" | "status" | "resolved_at" | "resolved_by" | "resolved_by_agent"
  >
>;

export async function insertTask(row: TaskInsert): Promise<string> {
  const { data, error } = await supabaseAdmin()
    .from("channel_tasks")
    .insert(row)
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

/** Author-scoped, matching `channel_tasks_client_msg_author_key`. */
export async function findOwnTaskIdByClientId(
  channelId: string,
  createdBy: string,
  clientMsgId: string
): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from("channel_tasks")
    .select("id")
    .eq("channel_id", channelId)
    .eq("client_msg_id", clientMsgId)
    .eq("created_by", createdBy)
    .maybeSingle();
  if (error) throw error;
  return (data as { id: string } | null)?.id ?? null;
}

export async function findTask(
  channelId: string,
  taskId: string
): Promise<ChannelTaskReadRow | null> {
  const { data, error } = await supabaseAdmin()
    .from("channel_tasks")
    .select(TASK_READ_COLS)
    .eq("channel_id", channelId)
    .eq("id", taskId)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as ChannelTaskReadRow | null) ?? null;
}

export async function listTasks(
  channelId: string,
  status: string | null,
  limit: number
): Promise<ChannelTaskReadRow[]> {
  let query = supabaseAdmin()
    .from("channel_tasks")
    .select(TASK_READ_COLS)
    .eq("channel_id", channelId);
  if (status !== null) query = query.eq("status", status);
  const { data, error } = await query.order("updated_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as ChannelTaskReadRow[];
}

export async function updateTask(
  channelId: string,
  taskId: string,
  patch: TaskPatch
): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("channel_tasks")
    .update(patch)
    .eq("channel_id", channelId)
    .eq("id", taskId);
  if (error) throw error;
}

/** Inserts the assignee unless that actor already holds the task. Returns the new row's id, or null. */
export async function insertAssignee(
  taskId: string,
  userId: string,
  agentId: string | null
): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from("channel_task_assignees")
    .upsert(
      { task_id: taskId, user_id: userId, agent_id: agentId },
      { onConflict: "task_id,user_id,agent_id", ignoreDuplicates: true }
    )
    .select("id");
  if (error) throw error;
  return (data as Array<{ id: string }> | null)?.[0]?.id ?? null;
}

/** An agent is matched by its id alone, so an ended agent can still be unassigned. */
export async function deleteAssignee(
  taskId: string,
  actor: { userId: string; agentId: null } | { agentId: string }
): Promise<number> {
  let query = supabaseAdmin().from("channel_task_assignees").delete().eq("task_id", taskId);
  query =
    actor.agentId === null
      ? query.eq("user_id", actor.userId).is("agent_id", null)
      : query.eq("agent_id", actor.agentId);
  const { data, error } = await query.select("id");
  if (error) throw error;
  return (data ?? []).length;
}

type SubtaskInsert = Pick<
  TaskSubtaskRow,
  "task_id" | "position" | "title" | "detail" | "owner_user_id" | "owner_agent_id" | "created_by" | "client_msg_id"
>;

export type SubtaskPatch = Partial<
  Pick<TaskSubtaskRow, "title" | "detail" | "owner_user_id" | "owner_agent_id" | "state">
>;

export async function insertSubtask(row: SubtaskInsert): Promise<string> {
  const { data, error } = await supabaseAdmin().from("channel_task_subtasks").insert(row).select("id").single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function findOwnSubtaskIdByClientId(
  taskId: string,
  createdBy: string,
  clientMsgId: string
): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from("channel_task_subtasks")
    .select("id")
    .eq("task_id", taskId)
    .eq("client_msg_id", clientMsgId)
    .eq("created_by", createdBy)
    .maybeSingle();
  if (error) throw error;
  return (data as { id: string } | null)?.id ?? null;
}

/** Returns whether a subtask of this task matched. */
export async function updateSubtask(
  taskId: string,
  subtaskId: string,
  patch: SubtaskPatch
): Promise<boolean> {
  const { data, error } = await supabaseAdmin()
    .from("channel_task_subtasks")
    .update(patch)
    .eq("task_id", taskId)
    .eq("id", subtaskId)
    .select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}

type NoteInsert = Pick<
  TaskNoteRow,
  "task_id" | "author_user_id" | "author_agent_id" | "body" | "client_msg_id"
>;

export async function insertNote(row: NoteInsert): Promise<string> {
  const { data, error } = await supabaseAdmin().from("channel_task_notes").insert(row).select("id").single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function findOwnNoteIdByClientId(
  taskId: string,
  authorUserId: string,
  clientMsgId: string
): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from("channel_task_notes")
    .select("id")
    .eq("task_id", taskId)
    .eq("client_msg_id", clientMsgId)
    .eq("author_user_id", authorUserId)
    .maybeSingle();
  if (error) throw error;
  return (data as { id: string } | null)?.id ?? null;
}

/** Newest first. */
export async function listNotes(taskId: string, limit: number): Promise<TaskNoteRow[]> {
  const { data, error } = await supabaseAdmin()
    .from("channel_task_notes")
    .select("*")
    .eq("task_id", taskId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as TaskNoteRow[];
}
