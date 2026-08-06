import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { SessionStateRow, SessionStateUpsert } from "./collab-dto";

/**
 * DATA ACCESS FOR `channel_sessions` — read-session-state's storage (rollback
 * §3.5), both directions: the desktop's push in, and the MCP op's read out.
 *
 * SPLIT OUT OF `repository-collab.ts` (§2, F-147). That file holds the v1.2
 * collaboration tables (consent, trust, presence) and the write half pushed it
 * to 532 of the 500-line cap. The seam is a real one and not a line-count
 * dodge: this is one TABLE with one writer and one reader, it arrived with the
 * rollback rather than with v1.2, and its two functions are the only place in
 * the tree that knows the shape of a session row.
 *
 * EVERY FUNCTION HERE USES THE RLS-BYPASSING ADMIN CLIENT, which is not a
 * convenience — the table `REVOKE`s INSERT/UPDATE/DELETE from `authenticated`
 * and `anon` outright, so there is no other way to write it. That makes the
 * `user_id` / `workspace_id` arguments below the entire fence, and both come
 * from the authenticated context in `session-state-service.ts`. Nothing here
 * may ever read an identity out of a payload.
 */

// One member's live sessions are bounded by the desktop's window budget
// (MAX_SESSION_WINDOWS), so this is far above any real machine and exists only
// to make a truncation loud rather than silent. PostgREST truncates an
// un-limited select SILENTLY.
const SESSION_ROWS_LIMIT = 500;

// ─── Session states (rollback §3.5, read-session-state) ─────────────

/**
 * PostgREST's code for "that relation is not in the schema cache" — the answer
 * a select gets when the table does not exist (or has not been reloaded into
 * the API's cache yet). See {@link listSessionStates} for why it is not an
 * error here. Matched on the CODE, never on the message, which is prose.
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
 * one channel. Scoped to `userId` here (and by RLS) because a session belongs
 * to one member's machine and read-session-state answers about the caller's own
 * — a peer has no read on it.
 *
 * ~~The write half is NOT wired in this phase.~~ **F-147 wired it** — see
 * {@link replaceSessionStates} below, whose one caller is the desktop's
 * `main/session-state-push.js`. An empty answer now means what it always said
 * it meant: no machine of the caller's is reporting anything.
 *
 * F-145 — AND THE MIGRATION IS THE OTHER HALF OF THAT SENTENCE. F-144 shipped
 * `channel_sessions` UNAPPLIED (Samuel's gauntlet applies it), so on the live
 * database this select answered `PGRST205` and the throw travelled all the way
 * out: `mapChannelError` has no arm for a raw PostgREST error, so the route
 * returned a 500 INTERNAL_ERROR. Four places — this function's own docblock,
 * `session-state-service`, the route, and F-144 — all claimed it "returns []
 * live", and none of them was true.
 *
 * SO THE MISSING RELATION IS DEGRADED TO THE HONEST EMPTY ANSWER, and the op is
 * correct whether or not the migration has landed: "no live sessions are being
 * reported" is exactly what a table with no rows and a table that does not yet
 * exist both mean to the caller — the writer exists now (F-147), but it cannot
 * have stored anything in a relation that is not there. This is deliberately
 * NARROW — one PostgREST code, nothing else. A permission
 * error, a column mismatch, a dead connection and a timeout all still throw,
 * because each of those means the answer is UNKNOWN rather than EMPTY, and an
 * empty list is a claim.
 *
 * DELETE THIS DEGRADE once the table is applied everywhere and the desktop push
 * has landed: past that point a missing relation is a real deployment fault and
 * should be loud.
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

/** The columns the reconcile compares. `id` / `created_at` / `updated_at` are
 *  deliberately absent: they are the row's identity and the row's history, and
 *  neither is something the desktop reports or the diff should look at. */
const SESSION_DIFF_COLUMNS =
  "session_key, channel_id, task_id, name, state, channel_name, thread_title";

/** Row-shaped comparison of what is stored against what was reported. Field by
 *  field rather than JSON.stringify, because key ORDER differs between a
 *  PostgREST row and a service-built object and a string compare would then
 *  report every row as changed — which is the failure that would touch every
 *  `updated_at` on every push and quietly destroy the read's ordering. */
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
 * REPLACE the caller's whole live set for one workspace (rollback §3.5, the
 * write half of read-session-state — F-144's flagged delivery gap, now wired).
 *
 * THE SCOPE IS `(userId, workspaceId)` AND BOTH COME FROM THE CONTEXT. The table
 * `REVOKE`s INSERT/UPDATE/DELETE from `authenticated`/`anon`, so this runs on the
 * admin client with RLS bypassed and the fence is this function — exactly as
 * {@link listSessionStates} is the fence for the read. There is no field in
 * {@link SessionStateUpsert} for a user id, so no payload can name another
 * member's rows.
 *
 * WHY THE WHOLE SET AND NOT A DELTA. The row's lifetime is the pill's lifetime
 * (F-142), and a delta needs an explicit removal message a crashed desktop never
 * sends. A full set makes removal implicit — anything not listed is deleted here
 * — so rows cannot accumulate, which is plan §5's whole point about NOT being
 * `agent_presence`.
 *
 * WHY IT READS FIRST. `updated_at` is the read's `ORDER BY` and the field the
 * MCP result reports as "when the desktop last reported a change for this
 * session" (the trigger stamps it on every UPDATE, F-145). Upserting the whole
 * set unconditionally would touch every row on every push, so five sessions
 * would all claim to have changed when one of them did, and the ordering would
 * become arbitrary while still looking plausible — the exact failure shape the
 * migration's `updated_at` note describes. So the reconcile writes only rows
 * that actually differ, and a push where nothing changed costs one SELECT.
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
