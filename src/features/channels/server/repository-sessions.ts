import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { SessionStateRow, SessionStateUpsert } from "./collab-dto";
// ⚠ WHAT COUNTS AS THE SAME ROW lives beside this file, not in it — split at the
// §1 cap on 2026-09-01, by QUESTION rather than by size: this file answers "what
// does a session read RETURN" (the fences, the bound, the missing-relation
// degrade), that one answers "what counts as the SAME ROW". They change for
// different reasons — a fence moves when the audience does, the column list moves
// every time the desktop reports a new field. See that module's header.
import {
  SESSION_DIFF_COLUMNS,
  sessionRowMatches,
} from "./repository-sessions-columns";

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
// live ceiling (`dopl-desktop-app/main/session-windowless.js ›
// MAX_CONCURRENT_SESSIONS`, 15 since 2026-09-01 — 6 when this was written on
// 2026-08-22); exists only to make truncation loud.
//
// ⚠ THE DERIVATION HAD A SECOND TERM AND IT IS GONE (2026-08-22, F-269 — the
// same correction `schema-sessions.ts › SESSION_REPORT_MAX` took as F-255, which
// left this copy behind). It read "plus `main/session-summary.js › MAX_ENDED`,
// 12", and **`MAX_ENDED` IS DELETED**: ended-agent retention moved to a durable
// seven-day history (`main/agent-history.js`), which no in-memory 12 bounds. The
// term never belonged here anyway — the wire set is LIVE ONLY
// (`main/session-state-push.js › liveForWire` drops ended rows before they are
// sent), so no quantity of retained ended agents reaches this table.
//
// ⚠ IT ALSO USED TO NAME `MAX_SESSION_WINDOWS`, THE WINDOW BUDGET, WHICH IS
// DELETED with the v1 session window. Same number, different thing: what is left
// counts RUNNING sessions rather than open windows, so it is the ceiling this
// limit has to stay far above. ⚠ The channel read below is NOT user-scoped — it
// spans every member's rows, so its headroom is that ceiling times the channel
// roster, which is the case that will reach 500 first if one ever does.
const SESSION_ROWS_LIMIT = 500;

// ─── Session states (rollback §3.5, read-session-state) ─────────────

/**
 * PostgREST's code for "that relation is not in the schema cache". See
 * {@link listSessionStates} for why it is not an error here.
 * ⚠ Matched on the CODE, never the message, which is prose.
 * ⚠ EXPORTED SINCE 2026-09-01 for `repository-agent-owner.ts`, which needs the
 * SAME narrow predicate and would otherwise carry a second copy — and a second
 * copy of a rule whose whole value is being NARROW is the copy that gets widened.
 * ⚠ THE PREDICATE IS SHARED; WHAT IT DEGRADES **TO** IS NOT, and each caller
 * states its own direction: `[]` here ("no live sessions are reported"), `null`
 * there ("the projection cannot say who owns this"). Those are different claims
 * and neither may be inferred from the other.
 */
const PGRST_MISSING_RELATION = "PGRST205";

export function isMissingRelation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === PGRST_MISSING_RELATION
  );
}

/**
 * Postgres' FOREIGN-KEY VIOLATION. See {@link replaceSessionStates}'s F-241
 * block for the one case it is acted on.
 * ⚠ Matched on the CODE, never the message, which is prose — the same rule
 * {@link isMissingRelation} follows, and the reason the degrade below re-reads
 * `channel_tasks` rather than parsing which constraint was named.
 */
const PG_FOREIGN_KEY_VIOLATION = "23503";

function isForeignKeyViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === PG_FOREIGN_KEY_VIOLATION
  );
}

/**
 * Which of these thread ids still have a `channel_tasks` row.
 *
 * ⚠ IT RUNS ONLY ON THE FAILURE PATH (F-241) — never on a healthy push. A
 * pre-flight existence check on every report would add a query per push to
 * protect against a race that happens once per deleted thread, which is the
 * cost this whole table's design refuses.
 * ⚠ NOT WORKSPACE-FENCED, deliberately: it answers "does this row exist", and
 * the only use of the answer is to STOP writing an id. A narrower query could
 * only ever null MORE `task_id`s, never fewer, so the fence buys no safety and
 * would make a cross-workspace id (which the `channel_child_workspace_guard`
 * trigger refuses anyway) read as merely dead.
 */
async function liveTaskIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_tasks")
    .select("id")
    .in("id", ids);
  if (error) throw error;
  return new Set(((data ?? []) as Array<{ id: string }>).map((r) => r.id));
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
  return sessionRowsWhere((q) => {
    const scoped = q.eq("user_id", userId).eq("workspace_id", workspaceId);
    return channelId ? scoped.eq("channel_id", channelId) : scoped;
  });
}

/**
 * The half-built select both fences narrow. ⚠ `supabaseAdmin()` is UNTYPED here —
 * the generated `Database` type does not carry the channels tables (this file's
 * header says so) — so this names the builder rather than inferring a row type,
 * and the cast to `SessionStateRow[]` stays at the single point below.
 */
export type SessionQuery = ReturnType<
  ReturnType<typeof supabaseAdmin>["from"]
>["select"] extends (...args: never[]) => infer Q
  ? Q
  : never;

/**
 * THE SHAPE BOTH SESSION READS SHARE — the projection, the ordering, the BOUND
 * and the missing-relation DEGRADE. Only the FENCE is the caller's.
 *
 * ⚠ EXTRACTED 2026-08-20 BECAUSE THE DEGRADE IS THE PART THAT MUST NOT DIVERGE.
 * The two reads were near-verbatim copies differing in one `.eq()` chain, and the
 * duplicated half was the subtle half: `isMissingRelation` → `[]` is a deliberate,
 * DELIBERATELY NARROW rule (one PostgREST code; a permission error, a column
 * mismatch, a dead connection and a timeout all still throw, because each means
 * UNKNOWN rather than EMPTY, and an empty list is a claim). Two copies of that is
 * two places to widen it by accident — and widening it turns "I could not ask"
 * into "there are none", which the callers cannot tell apart.
 * ⚠ It also keeps ONE `SESSION_ROWS_LIMIT` on both, which is what makes the bound
 * above a bound rather than a suggestion.
 *
 * ⚠ THE FENCE IS DELIBERATELY NOT SHARED. One read is USER-scoped, one is
 * CHANNEL-scoped and the third is USER-scoped ACROSS a proven channel set;
 * collapsing them into a single "filter" parameter would put three
 * authorization stories behind one signature, and they are not the same story
 * (see each caller's docblock). This shares the plumbing, never the fence.
 *
 * ⚠ **EXPORTED SINCE 2026-09-01 FOR A THIRD CALLER OUTSIDE THIS FILE** —
 * `repository-account.ts › listAccountSessionStates`, the account-wide read. It
 * lives there rather than here because its fence is the account-wide membership
 * set, which is that module's whole subject; it calls THIS because the degrade
 * and the bound are the halves that must never diverge, which is the same
 * argument that extracted this function in the first place. **A fourth caller
 * passes a fence and nothing else — never a widened one.**
 */
export async function sessionRowsWhere(
  fence: (query: SessionQuery) => SessionQuery
): Promise<SessionStateRow[]> {
  const db = supabaseAdmin();
  const { data, error } = await fence(db.from("channel_sessions").select("*"))
    .order("updated_at", { ascending: false })
    .limit(SESSION_ROWS_LIMIT);
  if (error) {
    if (isMissingRelation(error)) return [];
    throw error;
  }
  return (data ?? []) as SessionStateRow[];
}

/**
 * EVERY member's session rows for ONE channel (the Agents tab's peer cards,
 * 2026-08-20), newest change first. ⚠ The caller (session-state-service) has
 * already proved the reader may read this channel — this read is
 * channel-fenced, not user-fenced, and that is the point: it is the projection
 * peers may see (name / state / thread), nothing more.
 */
export async function listChannelSessionStates(
  workspaceId: string,
  channelId: string
): Promise<SessionStateRow[]> {
  return sessionRowsWhere((q) =>
    q.eq("workspace_id", workspaceId).eq("channel_id", channelId)
  );
}

/**
 * **THE OPERATOR-GIVEN NAME BEHIND AN AGENT ID** — `channel_sessions
 * .display_name`, for the read path's author labels (2026-09-04).
 *
 * ⚠ **ONE JOIN, PROJECTED TO TWO COLUMNS, FOR A WHOLE PAGE.** The MCP read
 * printed `agent for <operator>` and a bare id tail for a session its operator
 * had NAMED, so a reader could not tell one of an operator's agents from
 * another by the name everybody uses for them. The alternative to this read is a
 * name on every message row, which would be a stored copy of a value the
 * operator renames.
 *
 * ⚠ **A NAME IS PEER-TYPED AND IS NEUTRALIZED AT EVERY RENDER** — nothing here
 * validates it (the column CHECK bounds its LENGTH, not its charset), and
 * `packages/mcp-server/src/tools/channel-render.ts` states the rule for the
 * surface that splices it.
 *
 * ⚠ **NEWEST ROW WINS.** An agent id is minted per machine and is not a
 * database key, so two rows can in principle carry one — the same
 * `updated_at DESC` order every other session read takes, and the freshest
 * report is the current name.
 *
 * ⚠ **WORKSPACE-FENCED**, and the caller passes the set: a page can span
 * channels (the workspace hold) or workspaces (the account-wide read), and an
 * unfenced read over `name` alone would answer with rows from tenancies the
 * caller never proved.
 */
export async function agentDisplayNames(
  workspaceIds: readonly string[],
  agentIds: readonly string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (workspaceIds.length === 0 || agentIds.length === 0) return out;
  const rows = await sessionRowsWhere((q) =>
    q.in("workspace_id", [...workspaceIds]).in("name", [...agentIds])
  );
  for (const row of rows) {
    const name = row.display_name?.trim() ?? "";
    if (name.length === 0 || out.has(row.name)) continue;
    out.set(row.name, name);
  }
  return out;
}

/**
 * DROP EVERY member's session-state row that targets ONE thread — the thread
 * cascade's session step (`service-tasks-delete.ts › deleteTask`).
 *
 * ⚠ EVERY MEMBER'S, AND THAT IS NOT A WIDENING OF WHO MAY WRITE. These rows are
 * a PROJECTION of a desktop's live registry, not state anybody owns: the row's
 * whole content is "user U is running an agent on thread T". The thread is gone,
 * so the statement the row makes is gone, whoever's machine wrote it. ⚠ The
 * PEER'S ACTUAL AGENT IS NOT REACHABLE and is not touched — it dies on its own
 * idle/abandon timer, and until it does its next push re-inserts the row with
 * `task_id` nulled ({@link healDeadThreadRefs}, F-241). ⚠ **THAT ROW IS NOT
 * STALE, IT IS THREADLESS**, and the tab reads it as such: a thread-scoped
 * Agents tab drops it (no `threadId` to match), a channel-scoped one keeps it,
 * because the agent IS still running. ⚠ **This sentence claimed "the card's
 * freshness guard is what stops a stale row rendering" until 2026-08-22 — there
 * is no such guard any more.** `components/channels-v2/agents-model.ts ›
 * peerCardsFor` filters on membership, not on age (Samuel: the card stays until
 * the session goes away); age only DIMS a card now.
 *
 * ⚠ THE FK IS `ON DELETE SET NULL`, WHICH IS WHY THIS EXISTS. `channel_sessions
 * .task_id REFERENCES channel_tasks(id) ON DELETE SET NULL` (`20260805120000`),
 * so deleting the thread row would leave the session rows STANDING with a null
 * thread — a card reading "working" against no exchange. The delete has to be
 * explicit, and it has to run BEFORE the task row so the `task_id` it keys on is
 * still there.
 *
 * ⚠ TWO STATEMENTS, TWO KEYS, ON PURPOSE.
 *   1. `task_id = threadId` — the column, over `channel_sessions_task_idx`.
 *   2. `session_key LIKE '<channelId>:<threadId>%'` — the desktop's own stable
 *      key (`dopl-desktop-app/main/session-store.js › sessionKey`,
 *      `<channelId>:<taskId>:<agentId>`, and a two-segment legacy shape before
 *      2026-08-21). It catches a row whose `task_id` was already nulled by an
 *      earlier partial run, which the first statement cannot see.
 *   The pattern needs no escaping and cannot over-reach: both ids are UUIDs, so
 *   they contain no `%`, no `_` and no colon, and one fixed-length UUID is never
 *   a prefix of another.
 */
export async function deleteSessionStatesForThread(
  workspaceId: string,
  channelId: string,
  threadId: string
): Promise<void> {
  const db = supabaseAdmin();
  const { error: byTask } = await db
    .from("channel_sessions")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("task_id", threadId);
  if (byTask) throw byTask;
  const { error: byKey } = await db
    .from("channel_sessions")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("channel_id", channelId)
    .like("session_key", `${channelId}:${threadId}%`);
  if (byKey) throw byKey;
}

/**
 * F-241 — A THREAD CAN BE DELETED WHILE A PEER'S MACHINE IS STILL RUNNING AN
 * AGENT ON IT, AND ONE DEAD `task_id` MUST NOT POISON THE WHOLE REPLACE.
 *
 * THE RACE, in full. `channel_sessions.task_id REFERENCES channel_tasks(id)`.
 * The thread cascade (`service-tasks-delete.ts › deleteTask`) deletes EVERY
 * member's session rows for that thread — but a peer's actual AGENT is not
 * reachable from any server: it lives in another main process and stops on its
 * own idle/abandon timer. Until then that desktop keeps reporting the session,
 * and its next push RE-INSERTS the dead id. The upsert is ONE statement over
 * the whole changed set, so a single `23503` failed `reportSessionStates`
 * entirely: that operator's every OTHER session stopped being reported, their
 * peer cards went stale workspace-wide, and the route answered 500 — for a
 * thread somebody deleted on purpose.
 *
 * THE DEGRADE, and why it is this one. On a foreign-key violation, re-read
 * which of the reported thread ids still exist and NULL only the dead ones,
 * then let the caller retry once. **Nulling `task_id` is not a lie**: the row's
 * other half — "user U is running an agent, in channel C, state working" — is
 * still true, and it is exactly what the column's own `ON DELETE SET NULL`
 * would have left behind had the row been stored before the delete. The
 * alternatives were worse: dropping the row silently loses a LIVE agent from
 * the projection, and nulling every `task_id` in the batch would discard the
 * thread of rows whose threads are perfectly alive.
 *
 * ⚠ IT NEVER GUESSES WHICH CONSTRAINT FAILED. `channel_sessions` has four
 * FOREIGN KEYS (workspace, user, channel, task) and this matches on the CODE
 * alone — the house rule, because a constraint NAME in an error message is
 * prose. If nothing in the batch names a dead thread, the original error is
 * RETHROWN unchanged: a 23503 on `channel_id` means the CHANNEL is gone, which
 * nulling a thread id cannot fix and must not be made to look fixed.
 * ⚠ ONE RETRY, BY CONSTRUCTION. This function returns rows; the caller upserts
 * them once more and throws on failure. There is no loop, so a violation this
 * degrade does not cover cannot spin.
 */
async function healDeadThreadRefs<T extends { task_id: string | null }>(
  rows: T[],
  error: unknown
): Promise<T[]> {
  if (!isForeignKeyViolation(error)) throw error;
  const wanted = [
    ...new Set(rows.map((r) => r.task_id).filter((id): id is string => !!id)),
  ];
  const live = await liveTaskIds(wanted);
  const dead = wanted.filter((id) => !live.has(id));
  // Not the thread FK (or nothing to null): the caller's error stands.
  if (dead.length === 0) throw error;
  return rows.map((r) =>
    r.task_id && !live.has(r.task_id) ? { ...r, task_id: null } : r
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
 *
 * ⚠ EXACTLY ONE DEGRADE, AND IT IS NOT THAT ONE: a FOREIGN-KEY violation naming
 * a thread that has been deleted under a still-running peer agent (F-241) nulls
 * those rows' `task_id` and retries ONCE — see {@link healDeadThreadRefs} for
 * why that is honest rather than a swallow, and why it never guesses which
 * constraint failed. ⚠ **Do NOT widen this into a blanket try/catch.** Every
 * other error here means the store did not happen, and reporting one that did
 * not is the failure this whole docblock is about.
 *
 * ⚠ KEEP THIS BLOCK ATTACHED. It was orphaned once already, when
 * {@link listChannelSessionStates} was inserted between it and this function —
 * the docblock then read as that read's contract, which is a different fence
 * (channel-scoped, not user-scoped) and the opposite degrade rule.
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
  // ⚠ THROUGH `unknown`, and the reason is worth a line rather than a `@ts-expect-error`:
  // `SESSION_DIFF_COLUMNS` stopped being a single string LITERAL when the telemetry columns
  // made it too long for one line, so the client can no longer infer a row shape from it and
  // widens `data` to its error union. The cast was always the boundary here (the admin client
  // is untyped — see this file's header); it now needs two steps to say so.
  for (const row of (data ?? []) as unknown as SessionStateUpsert[]) {
    stored.set(row.session_key, row);
  }

  const changed = reported.filter((r) => {
    const current = stored.get(r.session_key);
    return !current || !sessionRowMatches(current, r);
  });
  if (changed.length > 0) {
    const rows = changed.map((r) => ({
      ...r,
      user_id: userId,
      workspace_id: workspaceId,
    }));
    const { error } = await db
      .from("channel_sessions")
      .upsert(rows, { onConflict: "user_id,session_key" });
    if (error) {
      const healed = await healDeadThreadRefs(rows, error);
      const retry = await db
        .from("channel_sessions")
        .upsert(healed, { onConflict: "user_id,session_key" });
      if (retry.error) throw retry.error;
    }
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
