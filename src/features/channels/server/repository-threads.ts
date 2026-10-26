import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { CHANNEL_THREAD_LIST_LIMIT } from "../constants";
import {
  CHANNEL_THREAD_ACTIVITY_COLS,
  type ChannelThreadActivityRow,
  type ChannelThreadRow,
} from "./dto";

/**
 * Pure data access for `channel_threads` (v15). Split out of `repository.ts` so
 * that file stays under the 500-line cap. Every function uses the service-role
 * admin client (RLS-bypassing) — visibility + authz live in the service layer.
 * Writes are service-role only (base DML REVOKEd from authenticated/anon).
 */

type ThreadInsert = {
  channel_id: string;
  workspace_id: string;
  title: string;
  mode: string;
  created_by: string;
  target_user_id: string | null;
  /** Idempotency key — a partial unique index dedups (channel_id, client_msg_id, created_by). */
  client_msg_id?: string | null;
};

export async function insertThread(row: ThreadInsert): Promise<ChannelThreadRow> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_threads")
    .insert(row)
    .select("*")
    .single();
  if (error) throw error;
  return data as ChannelThreadRow;
}

/**
 * THE IDEMPOTENCY PROBE for threads — (channel, CREATOR, client_msg_id).
 * `createThread`'s short-circuit and its lost-race repair, and nothing else.
 *
 * ⚠ WHY THE AUTHOR IS PART OF THE KEY. Idempotency is a SAME-AUTHOR RETRY
 * contract: "I already sent this, give me back what you stored". Channel-scoped,
 * it was a contract with the whole ROOM — a member who reused a key another
 * member had used was handed back THEIR thread, and the served MCP schema said
 * so out loud. The keys are derived and guessable: `service-threads-broadcast.ts ›
 * addresseeClientMsgId` mints `${base}:${toUserId}` over ids every member can
 * read. Same vulnerability, same shape, same fix as
 * `repository-messages.ts › findOwnMessageByClientId`.
 *
 * ⚠ THE DATABASE AGREES WITH THIS FUNCTION, and it has to: the unique index is
 * `(channel_id, client_msg_id, created_by)`
 * (`supabase/migrations/20260913120000_channel_tasks_author_scoped_idempotency.sql`).
 * Scoping only the READ turns the silent redirect into a `23505` the caller sees
 * as a 500. Change one, change both.
 *
 * ⚠ COLUMN ORDER IN THAT INDEX IS `(channel_id, client_msg_id, created_by)`, not
 * the argument order here — the leading pair stays a usable prefix.
 */
export async function findOwnThreadByClientId(
  channelId: string,
  createdBy: string,
  clientMsgId: string
): Promise<ChannelThreadRow | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_threads")
    .select("*")
    .eq("channel_id", channelId)
    .eq("client_msg_id", clientMsgId)
    .eq("created_by", createdBy)
    .maybeSingle();
  if (error) throw error;
  return (data as ChannelThreadRow | null) ?? null;
}

/** One thread, scoped to its channel (used for authz-scoped loads + stamping). */
export async function findThreadByChannelAndId(
  channelId: string,
  threadId: string
): Promise<ChannelThreadRow | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_threads")
    .select("*")
    .eq("channel_id", channelId)
    .eq("id", threadId)
    .maybeSingle();
  if (error) throw error;
  return (data as ChannelThreadRow | null) ?? null;
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
interface ChannelThreadPage {
  rows: ChannelThreadActivityRow[];
  truncated: boolean;
}

/**
 * A channel's threads, ordered by LAST ACTIVITY (2026-08-18). Bounded, and the
 * return shape says when the bound bit.
 *
 * WHY NOT `created_at DESC`, WHICH THIS WAS. That is the order threads were
 * OPENED in. Threads no longer close, so nothing ever leaves this list and
 * opening order buries the live exchange under whatever was started most
 * recently. WHY NOT `channel_threads.updated_at` either: {@link updateThread} is
 * its only writer, and since Phase 4 (2026-08-18) `set_mode` is its only
 * caller, so it equals `created_at` for nearly every thread — that was C-1, and
 * the fix is not to write to it more.
 *
 * THE CLOCK IS `channel_messages`, DERIVED ONCE, IN SQL. The
 * `channel_threads_activity` view is the whole definition of thread activity.
 * ⚠ Do not re-sort the result anywhere; the ORDER
 * is what the LIMIT clips against, so a caller that re-sorts is looking at the
 * wrong 200 rows.
 *
 * ⚠ ONE WRITE-PATH CALLER, AND IT IS A DM-ONLY PATH:
 * `service-writes-metadata.ts › resolveInheritableThread` runs only after a
 * direct channel's peer resolves, so the lateral it pays for spans one pair's
 * threads. Nothing was added to the write path itself (INVARIANTS §12) — no
 * trigger, no touch, no second round trip.
 */
export async function listThreadsByChannel(
  channelId: string,
  limit: number = CHANNEL_THREAD_LIST_LIMIT
): Promise<ChannelThreadPage> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_threads_activity")
    .select(CHANNEL_THREAD_ACTIVITY_COLS)
    .eq("channel_id", channelId)
    // ⚠ `created_at` is the TIE-BREAK, never the spine: threads opened in the
    // same second with no traffic would otherwise page nondeterministically,
    // and a nondeterministic order under a LIMIT drops rows at random.
    .order("last_activity_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  const rows = (data ?? []) as unknown as ChannelThreadActivityRow[];
  return { rows, truncated: rows.length >= limit };
}

/**
 * ⚠ ONE FIELD LEFT. `status` / `outcome` / `closed_at` / `outcome_summary` were
 * patchable here until thread closing was removed (Phase 4, 2026-08-18); those
 * COLUMNS survive carrying legacy `closed` rows, but nothing writes them any
 * more and nothing reads them.
 */
type ThreadPatch = Partial<{
  mode: string;
}>;

/**
 * Patch a thread's mode. `updated_at` is always bumped. The patch never touches
 * `workspace_id` / `channel_id`, so the workspace-consistency guard (which fires
 * only on UPDATE OF those columns) is never re-triggered.
 *
 * ⚠ THIS IS THE ONLY WRITER TO `channel_threads.updated_at`, AND THAT COLUMN IS
 * NOT AN ACTIVITY CLOCK. It means "this ROW was modified" — and since close and
 * reopen were deleted (Phase 4), `set_mode` is the ONLY path that reaches here,
 * so the column now equals `created_at` for every thread whose mode was never
 * changed. Posting into a thread does not touch it (`postMessage` bumps
 * `channels.updated_at`). Anything that wants "when did this thread last see
 * activity" reads `channel_threads_activity.last_activity_at` via
 * {@link listThreadsByChannel}, never this column: that mistake was C-1.
 */
export async function updateThread(
  threadId: string,
  patch: ThreadPatch
): Promise<ChannelThreadRow> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_threads")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", threadId)
    .select("*")
    .single();
  if (error) throw error;
  return data as ChannelThreadRow;
}

/**
 * REMOVE the thread row itself — the LAST step of the cascade.
 *
 * ⚠ CHANNEL-SCOPED, like every other write here: the id alone would let a
 * mis-resolved thread be deleted out of a channel the caller proved nothing
 * about. The service has already loaded the row through
 * {@link findThreadByChannelAndId}; this repeats the scope in the statement so the
 * authorization and the write cannot drift apart.
 *
 * ⚠ IT IS NOT A TOMBSTONE. `channel_threads` has no `deleted_at` and gains none —
 * threads hard-delete (INVARIANTS §5). The row is gone and so is its
 * `channel_threads_activity` projection.
 *
 * ⚠ NO REALTIME DOORBELL RIDES ON THIS. `channel_threads` is not in the
 * publication (INVARIANTS §7) and must not be added for it; the MESSAGE deletes
 * that precede it are what ring `channel_messages`, and every subscriber's
 * refetch re-reads the thread list off the back of that.
 */
export async function deleteThread(
  channelId: string,
  threadId: string
): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db
    .from("channel_threads")
    .delete()
    .eq("channel_id", channelId)
    .eq("id", threadId);
  if (error) throw error;
}

/**
 * ⚠ A conditional `UPDATE … WHERE status = $expected` USED TO LIVE HERE — it made FIRST CLOSE WIN (C-30,
 * 2026-08-08) when both parties to a thread clicked Close with different
 * outcomes. It is DELETED with thread closing (wiring plan Phase 4,
 * 2026-08-18): there is no transition left to serialize, and `set_mode` is
 * last-write-wins by design (the creator's own machine, one writer).
 *
 * The reusable half of it is worth keeping in mind and is NOT re-derivable from
 * the surviving code: **when two writers can disagree about a value, put the
 * guard inside the UPDATE statement, not in a read before it** — a service-level
 * pre-read narrows the race to milliseconds and never closes it. If a
 * compare-and-swap is ever needed on this table again, that is the shape (and
 * `.maybeSingle()`, because zero rows is the EXPECTED answer for the loser).
 */
