import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { CHANNEL_THREAD_LIST_LIMIT } from "../constants";
import {
  CHANNEL_TASK_ACTIVITY_COLS,
  type ChannelTaskActivityRow,
  type ChannelTaskRow,
} from "./dto";

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

/**
 * One page of a channel's threads, MOST RECENTLY ACTIVE FIRST, plus whether the
 * ceiling clipped it.
 *
 * ⚠ `truncated` is `rows.length >= limit`, i.e. AT the ceiling counts as
 * clipped — at is indistinguishable from over (INVARIANTS §9). A cap that
 * renders identically to an exhausted list is the bug, not the fix, so every
 * surface that renders this list says so when it is true.
 */
export interface ChannelTaskPage {
  rows: ChannelTaskActivityRow[];
  truncated: boolean;
}

/**
 * A channel's threads, ordered by LAST ACTIVITY (2026-08-18). Bounded, and the
 * return shape says when the bound bit.
 *
 * WHY NOT `created_at DESC`, WHICH THIS WAS. That is the order threads were
 * OPENED in. Threads no longer close, so nothing ever leaves this list and
 * opening order buries the live exchange under whatever was started most
 * recently. WHY NOT `channel_tasks.updated_at` either: {@link updateTask} is
 * its only writer, reached from close / set_mode / reopen alone, so it equals
 * `created_at` for every thread that was never closed — that was C-1, and the
 * fix is not to write to it more.
 *
 * THE CLOCK IS `channel_messages`, DERIVED ONCE, IN SQL. `channel_tasks_activity`
 * (migration `20260818120000`) carries the identical lateral
 * `channel_tasks_stale` uses — same definition of activity, written once, so the
 * ordering the sidebar sees and the ordering `list_threads` renders cannot
 * disagree. ⚠ Do not re-sort the result anywhere; the ORDER is what the LIMIT
 * clips against, so a caller that re-sorts is looking at the wrong 200 rows.
 *
 * ⚠ ONE WRITE-PATH CALLER, AND IT IS A DM-ONLY PATH:
 * `service-writes-metadata.ts › resolveInheritableTask` runs only after a
 * direct channel's peer resolves, so the lateral it pays for spans one pair's
 * threads. Nothing was added to the write path itself (INVARIANTS §12) — no
 * trigger, no touch, no second round trip.
 */
export async function listTasksByChannel(
  channelId: string,
  limit: number = CHANNEL_THREAD_LIST_LIMIT
): Promise<ChannelTaskPage> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_tasks_activity")
    .select(CHANNEL_TASK_ACTIVITY_COLS)
    .eq("channel_id", channelId)
    // ⚠ `created_at` is the TIE-BREAK, never the spine: threads opened in the
    // same second with no traffic would otherwise page nondeterministically,
    // and a nondeterministic order under a LIMIT drops rows at random.
    .order("last_activity_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  const rows = (data ?? []) as unknown as ChannelTaskActivityRow[];
  return { rows, truncated: rows.length >= limit };
}

/**
 * One row of the stale sweep's candidate list — the shape
 * `channel_tasks_stale` returns (migration `20260807160000`).
 */
export interface StaleThreadRow {
  id: string;
  channel_id: string;
  workspace_id: string;
  title: string;
  /**
   * The newest non-proposal message in the thread, falling back to the thread's
   * own `created_at`. NOT `channel_tasks.updated_at` — see below.
   */
  last_activity_at: string;
  /** Newest non-proposal `seq`; 0 for a thread nobody has posted into. */
  anchor_seq: number;
}

/**
 * Open threads whose LAST REAL ACTIVITY predates `before` (C-1, 2026-08-08,
 * F-171). Backs `/api/cron/stale-threads` and has no other caller.
 *
 * WHY THIS IS NOT A `.from("channel_tasks")` QUERY. The sweep used to filter on
 * `channel_tasks.updated_at`, and this repository's own {@link updateTask} is
 * the ONLY writer to that column — reached solely from close / set_mode /
 * reopen. `postMessage` bumps `channels.updated_at` and never touches the task
 * row. So `updated_at == created_at` for every thread that was never closed,
 * and the sweep swept a thread with hourly traffic as "no activity for a
 * while" while `set_thread_mode` reset the clock with zero activity. Activity
 * lives in `channel_messages`, so that is where the clock is read from; the
 * migration header records why this is a read-side derivation rather than a
 * trigger or a write-path touch (O(open threads) reads once a day beats
 * O(messages) writes forever).
 *
 * The RPC also refuses to select a thread whose newest message is already a
 * close proposal, so the sweep can never post over — and visually replace — an
 * agent's own stated reason.
 */
export async function listStaleOpenThreads(
  before: string,
  limit: number
): Promise<StaleThreadRow[]> {
  const db = supabaseAdmin();
  const { data, error } = await db.rpc("channel_tasks_stale", {
    p_before: before,
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as StaleThreadRow[];
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
 *
 * ⚠ THIS IS THE ONLY WRITER TO `channel_tasks.updated_at`, AND THAT COLUMN IS
 * NOT AN ACTIVITY CLOCK. It means "this ROW was modified", i.e. close /
 * set_mode / reopen — the only three paths that reach here. Posting into a
 * thread does not touch it (`postMessage` bumps `channels.updated_at`), so it
 * is equal to `created_at` for every thread that was never closed. Anything
 * that wants "when did this thread last see activity" must read
 * {@link listStaleOpenThreads}, never this column: that mistake was C-1, and it
 * made the stale sweep fire hardest on the busiest threads.
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

/**
 * Patch a task ONLY IF its `status` is still `expectedStatus` — the atomic half
 * of the close / reopen guards (C-30, 2026-08-08). Returns the updated row, or
 * `null` when the row's status had already moved (or the row is gone).
 *
 * WHY A CONDITIONAL UPDATE AND NOT A READ-THEN-WRITE. `closeTask` used to read
 * the row and write unconditionally, so BOTH parties to a thread could close it
 * — A as `completed`, B as `failed` — and the shared, permanent record of how
 * the exchange ended was whoever's UPDATE landed second. Reading `status` in the
 * service first narrows that window to the few milliseconds between the read and
 * the write; it does not close it, and "both parties clicked Close" is exactly
 * the situation the audit described. `.eq("status", expectedStatus)` inside the
 * UPDATE makes the transition itself the arbiter: PostgreSQL serializes the two
 * statements on the row, the first flips `open -> closed`, and the second matches
 * nothing and comes back `null`. FIRST WRITE WINS, and the loser is TOLD (the
 * service re-reads and reports the stored outcome) rather than silently
 * overwriting it.
 *
 * `.maybeSingle()` rather than `.single()` precisely because zero rows is the
 * EXPECTED answer here — `.single()` would turn the loser's ordinary no-op into
 * a thrown PostgREST error on a path whose whole point is that it did not fail.
 *
 * Same `updated_at` caveat as {@link updateTask}: this bumps it, and that column
 * is still not an activity clock.
 */
export async function updateTaskIfStatus(
  taskId: string,
  expectedStatus: "open" | "closed",
  patch: TaskPatch
): Promise<ChannelTaskRow | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_tasks")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", taskId)
    .eq("status", expectedStatus)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data as ChannelTaskRow | null) ?? null;
}
