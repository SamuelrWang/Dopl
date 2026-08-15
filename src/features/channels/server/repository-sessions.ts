import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { SessionStateRow, SessionStateUpsert } from "./collab-dto";

/**
 * DATA ACCESS FOR `channel_sessions` — read-session-state's storage, both
 * directions: the desktop's push in, the MCP op's read out. These two functions
 * are the only place in the tree that knows the shape of a session row.
 *
 * ⚠ EVERY FUNCTION USES THE RLS-BYPASSING ADMIN CLIENT, and not for convenience:
 * the table `REVOKE`s INSERT/UPDATE/DELETE from `authenticated` and `anon`, so
 * there is no other way to write it. That makes the `user_id` / `workspace_id`
 * arguments THE ENTIRE FENCE, and both come from the authenticated context in
 * `session-state-service.ts`. ⚠ Never read an identity out of a payload.
 */

// ⚠ PostgREST truncates an un-limited select SILENTLY. Far above the desktop's
// window budget (MAX_SESSION_WINDOWS); exists only to make truncation loud.
const SESSION_ROWS_LIMIT = 500;

// ─── Session states (rollback §3.5, read-session-state) ─────────────

/**
 * PostgREST's code for "that relation is not in the schema cache". See
 * {@link listSessionStates} for why it is not an error here.
 * ⚠ Matched on the CODE, never the message, which is prose.
 */
const PGRST_MISSING_RELATION = "PGRST205";

function isMissingRelation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === PGRST_MISSING_RELATION
  );
}

/**
 * The caller's OWN live sessions, newest change first, optionally narrowed to
 * one channel. ⚠ Scoped to `userId` here (and by RLS): a session belongs to one
 * member's machine and a peer has no read on it. Writer is the desktop's
 * `main/session-state-push.js` via {@link replaceSessionStates}.
 *
 * ⚠ A MISSING RELATION degrades to the honest empty answer, so the op is correct
 * whether or not the migration has landed — "no live sessions are reported" is
 * what an empty table and an absent table both mean to the caller. Deliberately
 * NARROW: one PostgREST code and nothing else. A permission error, a column
 * mismatch, a dead connection and a timeout all still THROW, because each means
 * the answer is UNKNOWN rather than EMPTY, and an empty list is a claim.
 *
 * ⚠ DELETE THIS DEGRADE once the table is applied everywhere — past that point a
 * missing relation is a real deployment fault and should be loud.
 */
export async function listSessionStates(
  userId: string,
  workspaceId: string,
  channelId?: string
): Promise<SessionStateRow[]> {
  const db = supabaseAdmin();
  let query = db
    .from("channel_sessions")
    .select("*")
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId);
  if (channelId) query = query.eq("channel_id", channelId);
  const { data, error } = await query
    .order("updated_at", { ascending: false })
    .limit(SESSION_ROWS_LIMIT);
  if (error) {
    if (isMissingRelation(error)) return [];
    throw error;
  }
  return (data ?? []) as SessionStateRow[];
}

/** Columns the reconcile compares. ⚠ `id` / `created_at` / `updated_at` are
 *  deliberately absent — identity and history, neither reported by the desktop
 *  nor something the diff should look at. */
const SESSION_DIFF_COLUMNS =
  "session_key, channel_id, task_id, name, state, channel_name, thread_title";

/** ⚠ Field by field, NEVER JSON.stringify: key ORDER differs between a
 *  PostgREST row and a service-built object, so a string compare reports every
 *  row as changed — touching every `updated_at` on every push and destroying
 *  the read's ordering. */
function sessionRowMatches(
  stored: SessionStateUpsert,
  reported: SessionStateUpsert
): boolean {
  return (
    stored.channel_id === reported.channel_id &&
    stored.task_id === reported.task_id &&
    stored.name === reported.name &&
    stored.state === reported.state &&
    stored.channel_name === reported.channel_name &&
    stored.thread_title === reported.thread_title
  );
}

/**
 * REPLACE the caller's whole live set for one workspace — the write half of
 * read-session-state.
 *
 * ⚠ SCOPE IS `(userId, workspaceId)` AND BOTH COME FROM THE CONTEXT. The table
 * `REVOKE`s INSERT/UPDATE/DELETE from `authenticated`/`anon`, so this runs with
 * RLS bypassed and THIS FUNCTION is the fence. {@link SessionStateUpsert} has no
 * user-id field, so no payload can name another member's rows.
 *
 * ⚠ THE WHOLE SET, NOT A DELTA: the row's lifetime is the pill's lifetime, and a
 * delta needs an explicit removal message a crashed desktop never sends. A full
 * set makes removal implicit — anything not listed is deleted — so rows cannot
 * accumulate.
 *
 * ⚠ IT READS FIRST. `updated_at` is the read's `ORDER BY` and what the MCP result
 * reports as "when the desktop last reported a change" (a trigger stamps it on
 * every UPDATE). Upserting the whole set unconditionally touches every row on
 * every push, so five sessions all claim to have changed when one did and the
 * ordering goes arbitrary while still looking plausible. The reconcile writes
 * only rows that differ; a push where nothing changed costs one SELECT.
 *
 * NOT DEGRADED ON `PGRST205`, unlike the read. The read can honestly answer "no
 * live sessions are being reported" over a missing table because the answer is
 * the same either way; a WRITE that swallowed it would report a store that did
 * not happen. Until the migration is applied this throws, the route answers 500,
 * and the desktop logs it once per workspace per run — which is the true state
 * of the world, said once.
 */
export async function replaceSessionStates(
  userId: string,
  workspaceId: string,
  reported: SessionStateUpsert[]
): Promise<{ stored: number; changed: number; removed: number }> {
  const db = supabaseAdmin();
  const { data, error: readError } = await db
    .from("channel_sessions")
    .select(SESSION_DIFF_COLUMNS)
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId)
    .limit(SESSION_ROWS_LIMIT);
  if (readError) throw readError;
  const stored = new Map<string, SessionStateUpsert>();
  for (const row of (data ?? []) as SessionStateUpsert[]) {
    stored.set(row.session_key, row);
  }

  const changed = reported.filter((r) => {
    const current = stored.get(r.session_key);
    return !current || !sessionRowMatches(current, r);
  });
  if (changed.length > 0) {
    const { error } = await db.from("channel_sessions").upsert(
      changed.map((r) => ({
        ...r,
        user_id: userId,
        workspace_id: workspaceId,
      })),
      { onConflict: "user_id,session_key" }
    );
    if (error) throw error;
  }

  const keep = new Set(reported.map((r) => r.session_key));
  const gone = [...stored.keys()].filter((key) => !keep.has(key));
  if (gone.length > 0) {
    // Deleted by explicit key through `.in()`, which the client escapes, rather
    // than by a `not.in` filter string this file would have to quote itself.
    const { error } = await db
      .from("channel_sessions")
      .delete()
      .eq("user_id", userId)
      .eq("workspace_id", workspaceId)
      .in("session_key", gone);
    if (error) throw error;
  }
  return { stored: reported.length, changed: changed.length, removed: gone.length };
}
