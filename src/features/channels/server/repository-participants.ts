import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { pgErrorCode } from "./repository";
import type { ThreadParticipantRow } from "./agents-dto";

/**
 * Pure data access for `channel_task_participants` — a thread's participant set
 * (the breakout room's membership). Split out of `repository.ts` so that file
 * stays under the 500-line cap (§2). Every function uses the service-role admin
 * client (RLS-bypassing) — visibility + authz live in the service layer. Writes
 * are service-role only (base DML REVOKEd from authenticated/anon).
 *
 * BOUNDARY: the table and its `task_id` column keep the storage `task`
 * spelling (§8); the domain calls the same id a THREAD id.
 */

/** Postgres SQLSTATE 23505 — this identity is already in the thread. */
const UNIQUE_VIOLATION = "23505";

/**
 * Explicit row cap. PostgREST truncates an un-limited select SILENTLY, and a
 * clipped participant set is a wrong membership decision, not a crash.
 */
const PARTICIPANT_ROWS_LIMIT = 500;

type ParticipantInsert = {
  task_id: string;
  workspace_id: string;
  kind: string;
  user_id: string | null;
  agent_id: string | null;
  added_by: string | null;
};

/**
 * Add an identity to a thread, IDEMPOTENTLY: joining twice is not an error, it
 * is a no-op that returns the row already there. The unique index
 * `(task_id, kind, coalesce(user_id, agent_id))` is what makes it safe under a
 * concurrent double-join — the read-then-write shape alone would race.
 */
export async function insertParticipant(
  row: ParticipantInsert
): Promise<ThreadParticipantRow> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_task_participants")
    .insert(row)
    .select("*")
    .single();
  if (!error) return data as ThreadParticipantRow;
  if (pgErrorCode(error) !== UNIQUE_VIOLATION) throw error;

  const existing = await findParticipant(
    row.task_id,
    row.kind,
    row.kind === "agent" ? row.agent_id : row.user_id
  );
  // The unique index just told us this row exists; a miss here means it was
  // deleted between the two statements, which is a real (if rare) conflict.
  if (!existing) throw error;
  return existing;
}

/**
 * One participant row by its thread + identity, or null. `identityId` is the
 * `agent_id` for an agent and the `user_id` for a user — the same discriminated
 * pair the unique index keys on.
 *
 * Exported for the join path, which reports 201-created vs. 200-already-there
 * and so has to know which one it did — {@link insertParticipant} is idempotent
 * by design and cannot tell it.
 */
export async function findParticipant(
  taskId: string,
  kind: string,
  identityId: string | null
): Promise<ThreadParticipantRow | null> {
  if (!identityId) return null;
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_task_participants")
    .select("*")
    .eq("task_id", taskId)
    .eq("kind", kind)
    .eq(kind === "agent" ? "agent_id" : "user_id", identityId)
    .maybeSingle();
  if (error) throw error;
  return (data as ThreadParticipantRow | null) ?? null;
}

/** A thread's whole participant set, oldest first (join order). */
export async function listParticipantsByTask(
  taskId: string
): Promise<ThreadParticipantRow[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_task_participants")
    .select("*")
    .eq("task_id", taskId)
    .order("created_at", { ascending: true })
    .limit(PARTICIPANT_ROWS_LIMIT);
  if (error) throw error;
  return (data ?? []) as ThreadParticipantRow[];
}

/**
 * Participant sets for MANY threads at once, grouped by thread id — the
 * channel-wide thread list hydrates every card's membership from this ONE
 * query instead of one per thread (an N+1 on a read the web polls). Threads
 * with no participants are simply absent from the map; the caller renders `[]`.
 *
 * An empty id list short-circuits: `in("task_id", [])` is a round trip that
 * can only ever return nothing. The row cap is shared across the WHOLE batch
 * (it bounds the response, which is the thing being protected); the caller
 * passes the thread page it is rendering, not the channel's whole history.
 */
export async function listParticipantsByTasks(
  taskIds: string[]
): Promise<Map<string, ThreadParticipantRow[]>> {
  const out = new Map<string, ThreadParticipantRow[]>();
  if (taskIds.length === 0) return out;
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_task_participants")
    .select("*")
    .in("task_id", taskIds)
    .order("created_at", { ascending: true })
    .limit(PARTICIPANT_ROWS_LIMIT);
  if (error) throw error;
  for (const row of (data ?? []) as ThreadParticipantRow[]) {
    const bucket = out.get(row.task_id);
    if (bucket) bucket.push(row);
    else out.set(row.task_id, [row]);
  }
  return out;
}

/**
 * Remove one identity from a thread (leave / eject). Idempotent by shape:
 * deleting an identity that is not in the set is a no-op, not an error.
 */
export async function deleteParticipant(
  taskId: string,
  kind: string,
  identityId: string
): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db
    .from("channel_task_participants")
    .delete()
    .eq("task_id", taskId)
    .eq("kind", kind)
    .eq(kind === "agent" ? "agent_id" : "user_id", identityId);
  if (error) throw error;
}
