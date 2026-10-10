import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { POSTGREST_MAX_ROWS, readAllPages } from "@/shared/supabase/max-rows";
import { isMissingRelation } from "./repository-sessions";

/**
 * DATA ACCESS FOR `workspace_token_spend` — the durable per-run token ledger
 * behind Overview's spend-over-time view (migration 20260927120000, whose
 * header carries the design).
 *
 * ⚠ EVERY FUNCTION USES THE RLS-BYPASSING ADMIN CLIENT, and not for
 * convenience: the table REVOKEs everything from `authenticated` and `anon` and
 * has no policies at all, so there is no other way to reach it. That makes the
 * `userId` / `workspaceId` arguments THE ENTIRE FENCE, and both come from the
 * authenticated context in `service-token-spend.ts`. ⚠ Never read an identity
 * out of a payload — the rule `repository-sessions.ts` states in capitals, and
 * this table is written from the same untrusted push.
 */

/** One run's reported spend, on its way into the ledger. Column vocabulary,
 *  because that is what the RPC's `jsonb` argument speaks. */
export type TokenSpendMark = {
  session_key: string;
  /** ISO-8601 with an offset. ⚠ THE RUN'S IDENTITY — see the migration header:
   *  `session_key` is reused by the next session on the same thread. */
  started_at: string;
  tokens: number;
  agent_name: string | null;
  channel_id: string | null;
};

/** One stored run, as the Overview read returns it. */
type TokenSpendRow = {
  started_at: string;
  tokens: number;
  agent_name: string | null;
  channel_id: string | null;
  workspace_id: string;
};

/**
 * THE WALK'S HARD CAP — how many runs one spend read will ever carry.
 *
 * The number is a month of runs for a heavy operator with room over: one row is
 * one SESSION RUN, not one message and not one tool call, and the window the
 * page reads is 31 days.
 *
 * 🔒 **IT USED TO BE A `.limit(2000)`, AND THAT WAS A WRONG ANSWER RATHER THAN A
 * SLOW ONE (Samuel #2935, the `max_rows` sweep).** `supabase/config.toml ›
 * max_rows` ({@link POSTGREST_MAX_ROWS}) clips every PostgREST select
 * server-side and raises NOTHING, so an ask of 2,000 came back as the newest
 * 1,000 runs — and because `truncated` was `rows.length >= 2000`, `1000 >= 2000`
 * was FALSE: a read that was a floor reported itself COMPLETE, and the strip drew
 * a short month as a quiet one with no clip note. ⚠ **BOTH HALVES WERE WRONG,
 * which is why raising `max_rows` would not have been the fix.**
 *
 * ⚠ **IT IS STILL A CEILING AND STILL REPORTED.** {@link readAllPages} returns
 * `truncated: true` on reaching it; the difference is that the rows beneath it
 * are now actually fetched instead of being cut at 1,000.
 */
const SPEND_ROWS_LIMIT = 2000;

/**
 * RECORD one push's worth of marks. Returns how many rows were inserted or
 * ADVANCED — a push where nothing spent anything new honestly returns 0.
 *
 * ⚠ ONE ROUND TRIP FOR THE WHOLE SET, and one statement inside it: the merge is
 * `GREATEST(stored, reported)`, which no PostgREST upsert can express (see the
 * migration's `record_token_spend` block for why a plain upsert is wrong rather
 * than merely inelegant — a lower figure arriving out of order would overwrite
 * a higher one).
 *
 * ⚠ THE WRITE IS IDEMPOTENT BY CONSTRUCTION, which is what lets the caller
 * degrade instead of failing the push: re-reporting a figure stores the same
 * figure, so a lost write is recovered by the next push carrying the same
 * cumulative number. ⚠ It is NOT recovered for a run whose LAST push is lost —
 * that spend is gone, which is the same class of under-count the migration
 * header already names, and it is why this table is documented as a floor.
 *
 * ⚠ A MISSING RELATION (or a missing FUNCTION) IS NOT AN ERROR HERE — it is
 * "the migration has not been applied to this environment yet", and it answers
 * `null` rather than 0. The distinction is load-bearing: 0 means "the ledger
 * took nothing new", `null` means "there is no ledger", and the caller must not
 * report the second as the first. ⚠ DELIBERATELY NARROW — two codes and nothing
 * else. A permission error, a bad argument, a dead connection and a timeout all
 * still THROW, because each means the write's outcome is UNKNOWN, and swallowing
 * one would report a store that did not happen.
 * ⚠ DELETE THIS DEGRADE once the migration is applied everywhere.
 */
export async function recordTokenSpend(
  userId: string,
  workspaceId: string,
  marks: TokenSpendMark[]
): Promise<number | null> {
  if (marks.length === 0) return 0;
  const db = supabaseAdmin();
  const { data, error } = await db.rpc("record_token_spend", {
    p_workspace_id: workspaceId,
    p_user_id: userId,
    p_marks: marks,
  });
  if (error) {
    if (isMissingLedger(error)) return null;
    throw error;
  }
  return typeof data === "number" ? data : 0;
}

/**
 * "The migration behind this feature is not applied here."
 *
 * ⚠ TWO CODES, because this feature ships a TABLE and a FUNCTION and an
 * environment can be missing either: `PGRST205` is PostgREST's unknown
 * relation (shared with `repository-sessions.ts › isMissingRelation`, imported
 * rather than re-spelled — a second copy of a rule whose whole value is being
 * narrow is the copy that gets widened) and `PGRST202` is its unknown
 * FUNCTION, which is what an un-migrated database answers to this `.rpc()`.
 * ⚠ Matched on the CODE, never the message, which is prose.
 */
function isMissingLedger(error: unknown): boolean {
  if (isMissingRelation(error)) return true;
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "PGRST202"
  );
}

/**
 * THE CALLER'S OWN SPEND since an instant, newest run first.
 *
 * ⚠ FENCED ON `user_id` ALONE, AND THAT IS THE WHOLE POINT. Overview is an
 * ACCOUNT surface that spans containers (`overview-panels.tsx`: "Overview is
 * about the account, and every section on it is cross-channel by
 * construction"), and "my agents' spend" is answered by this column without a
 * membership set to assemble. ⚠ It is also the NARROWEST possible fence: there
 * is no argument that widens it to a peer's rows, deliberately — nobody has
 * ruled that a workspace member may read a colleague's token spend.
 *
 * ⚠ A MISSING LEDGER DEGRADES TO AN EMPTY LIST, unlike the write. The claims
 * differ: an empty ledger and an absent one both mean "no spend is recorded for
 * you", so the answer is honest either way — the same argument
 * `listSessionStates` makes for its own read degrade, and the same narrowness.
 *
 * ── 🔒 PAGED, BECAUSE THE ANSWER IS THE LIST ITSELF ────────────────────────
 *
 * 🔒 **IT IS NOT SUMMED IN SQL, AND THAT IS A RULING RATHER THAN AN OVERSIGHT.**
 * Every other read in the `max_rows` sweep that folded rows became a group-by
 * aggregate; this one cannot, because **THIS SERVER NAMES NO DAYS** (Samuel,
 * 2026-09-06 — `service-token-spend.ts › readTokenSpend`). The strip buckets by
 * the operator's LOCAL day, which only the renderer knows, so the instants
 * themselves must travel. A `date_trunc` here would answer UTC buckets for a
 * local-day axis, and taking a UTC offset on the request is worse still: one
 * offset is wrong for part of any window spanning a DST change. So the fix is
 * {@link readAllPages} — every row, in pages the server will actually return.
 *
 * ⚠ **THE ORDER IS TOTAL, AND IT HAS TO BE.** Paging a non-unique ORDER BY lets
 * Postgres hand back a row twice and skip another between pages. `started_at` is
 * the run's identity but NOT unique on its own (two machines can start a run in
 * the same microsecond), so it is tie-broken down to the primary key:
 * `PRIMARY KEY (workspace_id, user_id, session_key, started_at)` and `user_id`
 * is already pinned by the fence, leaving `(started_at, session_key,
 * workspace_id)` unique within one caller's rows.
 * ⚠ `started_at DESC` STAYS FIRST — newest run first is the read's contract and
 * the shape of `workspace_token_spend_user_time_idx`.
 *
 * ⚠ **THE DEGRADE IS A `catch` NOW, NOT AN `error` BRANCH**, because the walk
 * throws what a page answered. Same two codes, same narrowness: everything that
 * is not "there is no ledger here" still propagates.
 */
export async function listTokenSpend(
  userId: string,
  since: string
): Promise<{ rows: TokenSpendRow[]; truncated: boolean }> {
  const db = supabaseAdmin();
  try {
    return await readAllPages<TokenSpendRow>(
      // ⚠ A FRESH QUERY PER PAGE. A Supabase builder is a one-shot thenable;
      // re-awaiting one re-sends the first range and the walk spins on page 0.
      async (from, toInclusive) => {
        const { data, error } = await db
          .from("workspace_token_spend")
          .select("started_at, tokens, agent_name, channel_id, workspace_id")
          .eq("user_id", userId)
          .gte("started_at", since)
          .order("started_at", { ascending: false })
          .order("session_key", { ascending: true })
          .order("workspace_id", { ascending: true })
          .range(from, toInclusive);
        return { data: (data ?? []) as unknown as TokenSpendRow[], error };
      },
      // ⚠ The page size is the SERVER's ceiling, which is what makes a short
      // page proof of exhaustion rather than proof of a clip.
      { hardCap: SPEND_ROWS_LIMIT, pageSize: POSTGREST_MAX_ROWS }
    );
  } catch (error) {
    if (isMissingLedger(error)) return { rows: [], truncated: false };
    throw error;
  }
}
