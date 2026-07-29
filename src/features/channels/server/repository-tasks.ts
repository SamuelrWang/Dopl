import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { ChannelTaskRow } from "./dto";

/**
 * Pure data access for `channel_tasks` (v15). Split out of `repository.ts` so
 * that file stays under the 500-line cap. Every function uses the service-role
 * admin client (RLS-bypassing) — visibility + authz live in the service layer.
 * Writes are service-role only (base DML REVOKEd from authenticated/anon).
 */

type TaskInsert = {
  channel_id: string;
  workspace_id: string;
  title: string;
  mode: string;
  created_by: string;
  target_user_id: string | null;
  /** Idempotency key — a partial unique index dedups (channel_id, client_msg_id). */
  client_msg_id?: string | null;
};

export async function insertTask(row: TaskInsert): Promise<ChannelTaskRow> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_tasks")
    .insert(row)
    .select("*")
    .single();
  if (error) throw error;
  return data as ChannelTaskRow;
}

/**
 * One task in a channel by idempotency key, or null. Backs create_task dedup:
 * a re-sent client_msg_id returns the already-created task instead of inserting
 * a second (mirrors `findMessageByClientId` for messages).
 */
export async function findTaskByClientId(
  channelId: string,
  clientMsgId: string
): Promise<ChannelTaskRow | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_tasks")
    .select("*")
    .eq("channel_id", channelId)
    .eq("client_msg_id", clientMsgId)
    .maybeSingle();
  if (error) throw error;
  return (data as ChannelTaskRow | null) ?? null;
}

/** One task, scoped to its channel (used for authz-scoped loads + stamping). */
export async function findTaskByChannelAndId(
  channelId: string,
  taskId: string
): Promise<ChannelTaskRow | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_tasks")
    .select("*")
    .eq("channel_id", channelId)
    .eq("id", taskId)
    .maybeSingle();
  if (error) throw error;
  return (data as ChannelTaskRow | null) ?? null;
}

/** All tasks in a channel, newest first. */
export async function listTasksByChannel(
  channelId: string
): Promise<ChannelTaskRow[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_tasks")
    .select("*")
    .eq("channel_id", channelId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ChannelTaskRow[];
}

type TaskPatch = Partial<{
  status: string;
  outcome: string | null;
  mode: string;
  closed_at: string | null;
  outcome_summary: string | null;
}>;

/**
 * Patch a task's status / mode. `updated_at` is always bumped. The patch never
 * touches `workspace_id` / `channel_id`, so the workspace-consistency guard
 * (which fires only on UPDATE OF those columns) is never re-triggered.
 */
export async function updateTask(
  taskId: string,
  patch: TaskPatch
): Promise<ChannelTaskRow> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_tasks")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", taskId)
    .select("*")
    .single();
  if (error) throw error;
  return data as ChannelTaskRow;
}
