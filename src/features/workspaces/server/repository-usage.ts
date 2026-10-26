import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import {
  clippedAt,
  readAllPages,
  type Clipped,
} from "@/shared/supabase/max-rows";
import { MCP_CALL_ROWS } from "@/features/analytics/server/mcp-tool-calls";
import type { Role } from "../types";

/**
 * DATA ACCESS FOR THE WORKSPACE OVERVIEW'S WAVE-8 PANELS — the credit ledger,
 * the MCP tool scan, the live agent board and this container's token spend.
 *
 * ⚠ **ITS OWN FILE BESIDE `repository-overview.ts`, NOT A WIDENING OF IT.**
 * That module is at 334 lines (measured 2026-09-17) against the 500-line cap
 * (§1), and these reads have a different fence story: the counts there are
 * workspace-wide aggregates, and two of the four here are fenced on a PERSON.
 *
 * ⚠ **EVERY FUNCTION TAKES `workspaceId` FROM `segment.ts › resolveApiWorkspace`
 * AND NOTHING A CALLER SENT.** These run on the service-role admin client, which
 * BYPASSES RLS (§2), so the argument list IS the fence.
 *
 * ⚠ THE ADMIN CLIENT IS UNTYPED HERE for the reason `repository-overview.ts`
 * gives: the generated `Database` type does not carry the channels tables, nor
 * `credit_usage_events`, nor `workspace_token_spend`.
 */

/**
 * Ceiling on a breakdown SCAN. ⚠ A scan AT its ceiling is indistinguishable
 * from an exhausted one, so every caller returns `truncated` beside the rows
 * and the surface says so (§9). Ordered NEWEST FIRST so a clip NARROWS the
 * window the shares describe rather than inventing a zero for an old bin.
 *
 * ⚠ **HALF `HOME_SCAN_LIMIT` (20,000) ON PURPOSE.** /home's scan spans every
 * container one person belongs to; this one spans one container's whole
 * membership, and the page gates on it.
 *
 * 🔒 **AND IT IS NOT THE BOUND THAT APPLIES — `supabase/config.toml › max_rows`
 * IS (Samuel #2935).** PostgREST clips every select at 1,000 server-side and
 * raises nothing, so each scan below returns the newest 1,000 rows of whatever
 * window it asked for. The reads that exist to be SUMMED or GROUPED now ask
 * Postgres for the groups ({@link sumWorkspaceCreditBins},
 * {@link tallyWorkspaceCredits}, {@link tallyWorkspaceMcpTools},
 * {@link tallyWorkspaceChannelMessages}) and keep these scans only as the
 * DEGRADE path for an un-applied migration.
 */
const WORKSPACE_SCAN_LIMIT = 10_000;

/** A scan that came back AT its ceiling is a FLOOR, and says so. */
export type UsageScan<T> = Clipped<T>;

/**
 * ⚠ **THE EFFECTIVE CEILING IS THE SMALLER OF THE ASKED LIMIT AND THE SERVER'S**,
 * and the local helper this replaces compared against the ASKED one — so
 * `1000 >= 10000` was false and every clipped scan here reported itself COMPLETE.
 * `shared/supabase/max-rows.ts` carries the finding and the test that pins the
 * number against `supabase/config.toml`.
 */
const clipped = clippedAt;


/** Codes for "that TABLE is not in this database" — `workspace_token_spend`
 *  (`20260927120000`) ships unapplied, and its page walk reports a missing
 *  relation as `PGRST205` through PostgREST or `42P01` straight from Postgres.
 *  ⚠ The AGGREGATES' own codes live with them in `repository-usage-tally.ts`. */
const LEDGER_ABSENT_CODES = new Set(["42P01", "PGRST205", "PGRST202"]);

/**
 * De Morgan of `NOT (tool = 'channel' AND op LIKE 'await%')`.
 *
 * ⚠ **THE SENTENCE IS SHARED, THE CONSTANT IS NOT** — the same trade
 * `home/server/repository-overview.ts › EXCLUDE_AWAIT_POLLING` records: two
 * features cannot share a module without one importing the other's repository
 * (§2 forbids it). `dopl_channel`'s await ops POLL, and unfiltered they dominate
 * every tool rail this page draws.
 */
const EXCLUDE_AWAIT_POLLING = "tool.neq.channel,op.not.like.await*";

/** The wallets a STANDARD workspace's own spend can sit on: the v2.1 per-member
 *  `seat`, and the LEGACY pooled `workspace` (the column's `DEFAULT`, every row
 *  written before 2026-09-07). ⚠ `home` is neither, and its absence is the
 *  whole fence — see {@link scanWorkspaceCreditEvents}. */
const WORKSPACE_WALLETS = ["seat", "workspace"];

export interface WorkspaceCreditEventRow {
  origin_workspace_id: string | null;
  user_id: string | null;
  /** WHICH COUNTER MOVED — `seat` | `workspace` here by construction. Read
   *  because it is half the predicate the service re-applies. */
  wallet: string;
  /** RULE B's dimension: the CALLING CHANNEL that was billed, `null` for a
   *  channel-less call ("Desktop agent") and for every pre-2026-09-13 row. */
  channel_id: string | null;
  amount: number;
  created_at: string;
}

/**
 * THE CREDIT LEDGER, fenced to the rows THIS WORKSPACE'S SEAT WALLETS PAID FOR.
 *
 * 🔒 **`docs/specs/credit-model-v2.md` §3 + RULE B READ BACKWARDS** — two
 * container arms under one wallet filter:
 *   1. `channel_id IN (this workspace's channels)` — rule B arm 2: a
 *      workspace-channel agent charges the caller's SEAT here whatever it
 *      touches, so its `origin_workspace_id` is often NOT this workspace and
 *      the channel is the only column that says the bill is.
 *   2. `origin_workspace_id = this workspace` — rule B arm 3, the channel-less
 *      call ("Desktop agent") and every legacy pooled row.
 * ⚠ **AND `wallet IN ('seat','workspace')` OVER BOTH.** A `personal` row
 * addressed at this workspace is a HOME channel's agent reaching in (rule B arm
 * 1) and is on no workspace figure — INVARIANTS §9: the meters must not be
 * summed. The wallet filter is an AND over the union, never a third arm.
 *
 * ⚠ **THE CHANNEL LIST IS UNFENCED BY VISIBILITY AND THE RAIL IS NOT**: these
 * rows are AMOUNTS, and `service-usage.ts` drops the ones whose channel the
 * caller cannot see where a NAME gets printed.
 *
 * ⚠ **A SUM WITH NO `SUM`** — PostgREST cannot aggregate, so this hauls the
 * window and the service adds it up (§9), `truncated` beside the shares.
 *
 * ⚠ **IT DEGRADES TO EMPTY RATHER THAN THROWING, and only this read does.**
 * `credit_usage_events` and its `wallet` / `channel_id` columns ship as
 * UNAPPLIED migrations (`20260901130000`, `20260930120000`, `20261003120000`),
 * and this read sits in the Overview payload's `Promise.all`, where a throw
 * 500s every panel. An empty ledger is an expected reading here anyway. ⚠
 * LOGGED, never silent.
 */
export async function scanWorkspaceCreditEvents(
  workspaceId: string,
  channelIds: readonly string[],
  sinceIso: string,
  opts: { untilIso?: string; limit?: number; channelId?: string | null } = {}
): Promise<UsageScan<WorkspaceCreditEventRow>> {
  const limit = opts.limit ?? WORKSPACE_SCAN_LIMIT;
  // ⚠ PostgREST has no syntax for an empty `in.()`, so the channel arm is
  // dropped rather than spelled empty — a workspace with no channels still has
  // an honest answer through the origin arm.
  const channelArm =
    channelIds.length > 0 ? `,channel_id.in.(${channelIds.join(",")})` : "";
  let query = supabaseAdmin()
    .from("credit_usage_events")
    .select("origin_workspace_id, user_id, wallet, channel_id, amount, created_at")
    .in("wallet", WORKSPACE_WALLETS)
    .or(`origin_workspace_id.eq.${workspaceId}${channelArm}`)
    .gte("created_at", sinceIso);
  if (opts.untilIso) query = query.lt("created_at", opts.untilIso);
  // ⚠ A NARROWING INSIDE THE FENCE ABOVE, never a fence of its own — PostgREST
  // composes this as a conjunction, so the wallet + container arms still decide
  // which rows EXIST and this only hides some of them. The caller proved the
  // channel is visible first (`service-overview.ts › isChannelVisibleTo`).
  if (opts.channelId) query = query.eq("channel_id", opts.channelId);
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.warn(
      `[workspaces/overview] credit ledger unreadable, degrading to empty: ${error.message}`
    );
    return { rows: [], truncated: false };
  }
  return clipped((data ?? []) as WorkspaceCreditEventRow[], limit);
}


export interface WorkspaceToolCallRow {
  tool: string;
  op: string;
}

/** The window's MCP calls in this workspace, for the tool rail. ⚠ TWO COLUMNS:
 *  this read exists to be COUNTED BY GROUP, and every other column would put
 *  something on the wire that never renders (§9). */
export async function scanWorkspaceMcpCalls(
  workspaceId: string,
  sinceIso: string,
  limit: number = WORKSPACE_SCAN_LIMIT
): Promise<UsageScan<WorkspaceToolCallRow>> {
  const { data, error } = await supabaseAdmin()
    .from("mcp_tool_calls")
    .select("tool, op")
    .eq("workspace_id", workspaceId)
    .gte("created_at", sinceIso)
    .or(EXCLUDE_AWAIT_POLLING)
    .not("tool", "like", MCP_CALL_ROWS)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return clipped((data ?? []) as WorkspaceToolCallRow[], limit);
}


/** Which channel each message in the window landed in. ⚠ ONE COLUMN, same rule
 *  as {@link scanWorkspaceMcpCalls}. */
export async function scanWorkspaceMessageChannels(
  workspaceId: string,
  sinceIso: string,
  limit: number = WORKSPACE_SCAN_LIMIT
): Promise<UsageScan<{ channel_id: string }>> {
  const { data, error } = await supabaseAdmin()
    .from("channel_messages")
    .select("channel_id")
    .eq("workspace_id", workspaceId)
    .eq("kind", "message")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return clipped((data ?? []) as Array<{ channel_id: string }>, limit);
}


/** How many channel ids the rule-B fence carries. ⚠ A HARD CAP ON A PAGE WALK,
 *  never a `.limit()` — see {@link listWorkspaceChannelIds} for why asking for it
 *  in one statement was the bug rather than the bound. */
const WORKSPACE_CHANNEL_IDS_LIMIT = 10_000;

/**
 * Every channel id in the container — the credit scan's rule-B arm. ⚠ IDS
 * ONLY: it fences a read, it never reaches a render, so a NAME here would be
 * content crossing a fence it was not checked against.
 *
 * 🔒 **PAGED, BECAUSE THIS ARRAY *IS* THE AGGREGATES' FENCE (Samuel #2935).** It
 * was an UNLIMITED select, so `supabase/config.toml › max_rows` answered the first
 * 1,000 channels and raised nothing — and this list is the `p_channel_ids`
 * argument of BOTH new aggregates ({@link sumWorkspaceCreditBins},
 * {@link tallyWorkspaceCredits} in `repository-usage-tally.ts`) as well as the TS
 * belt's `new Set(channelIds)` in `service-usage.ts › filterSeatBurns`. Past a
 * thousand channels the aggregate therefore INHERITED the exact clip it was
 * written to remove, THROUGH ITS OWN FENCE: every burn in a dropped channel
 * vanished from the series and from both rails, with no marker anywhere — the
 * aggregate cannot report a clip on rows its argument never named.
 *
 * ⚠ **THE ORDER IS NEW AND TOTAL: `channels.id` IS THE PRIMARY KEY.** This read
 * had none, which one statement can afford and a page walk cannot — an unordered
 * page may repeat an id the previous page already carried and skip another, and a
 * skipped channel id is a silently unfenced burn.
 * ⚠ ORDERED ON AND NEVER SELECTED is not available here (the projection IS `id`),
 * so the total order costs nothing at all.
 */
export async function listWorkspaceChannelIds(
  workspaceId: string
): Promise<string[]> {
  const { rows } = await readAllPages<{ id: string }>(
    // ⚠ A FRESH QUERY PER PAGE. A Supabase builder is a one-shot thenable;
    // re-awaiting one re-sends the first range and the walk spins on page 0.
    async (from, toInclusive) => {
      const { data, error } = await supabaseAdmin()
        .from("channels")
        .select("id")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .order("id", { ascending: true })
        .range(from, toInclusive);
      return { data: (data ?? []) as unknown as Array<{ id: string }>, error };
    },
    // ⚠ No `pageSize`: {@link readAllPages} already clamps its default to the
    // SERVER's ceiling, which is what makes a short page proof of exhaustion
    // rather than proof of a clip. Stated the same way as
    // {@link listWorkspaceTokenSpend} below.
    { hardCap: WORKSPACE_CHANNEL_IDS_LIMIT }
  );
  return rows.map((row) => row.id);
}

export interface WorkspaceSessionRow {
  id: string;
  channel_id: string | null;
  user_id: string;
  thread_id: string | null;
  name: string;
  display_name: string | null;
  state: string;
  detail: string | null;
  channel_name: string | null;
  thread_title: string | null;
  updated_at: string;
}

/**
 * EVERYONE'S LIVE agent sessions in this container, newest activity first
 * (R-25, 2026-09-17: every member's LIVE agent, never an ENDED one).
 *
 * 🔒 **PUBLIC COLUMNS ONLY — NOT ONE OF THE SEVEN OPERATOR-ONLY ONES.**
 * `model`, `tool_label`, `context_used`, `context_window`, `tokens_spent`,
 * `started_at` and `last_activity_at` are absent and must stay absent
 * (`20260822150000_channel_sessions_telemetry.sql`). This runs service-role, so
 * neither RLS nor the column GRANT applies and `collab-dto.ts ›
 * mapPeerSessionStateRow` is not on this path — **the column list IS the
 * fence**, and it fails closed by naming what may be read.
 */
export async function listWorkspaceRunningSessions(
  workspaceId: string,
  limit: number
): Promise<UsageScan<WorkspaceSessionRow>> {
  const { data, error } = await supabaseAdmin()
    .from("channel_sessions")
    .select(
      "id, channel_id, user_id, thread_id, name, display_name, state, detail, channel_name, thread_title, updated_at"
    )
    .eq("workspace_id", workspaceId)
    .neq("state", "ended")
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return clipped((data ?? []) as WorkspaceSessionRow[], limit);
}

/** How many roster rows the by-person rail's fence carries. ⚠ A HARD CAP ON A
 *  PAGE WALK, on {@link WORKSPACE_CHANNEL_IDS_LIMIT}'s argument. */
const WORKSPACE_ROSTER_LIMIT = 10_000;

/**
 * `userId → role` for every ACTIVE member — the roster, as the members console
 * reads it (`repository.ts › listMembers`; departure is a row DELETE, never a
 * status flip). 🔒 **The by-person rail's fence as well as its guest marker**:
 * a person absent from this map is absent from that rail.
 * ⚠ `workspace_members` is the ONLY table where `guest` exists.
 *
 * 🔒 **PAGED, AND THE SENTENCE ABOVE IS WHY (Samuel #2935).** This was an
 * UNLIMITED select clipped at 1,000 active members server-side with no error — and
 * it is simultaneously the rail's FENCE and its guest marker, so past a thousand
 * members the two failures compounded: a person with real spend was dropped from
 * the rail *and* from name resolution (`service-usage.ts › resolvePeopleNames`
 * fetches profiles only for ids the roster carries), and nothing said so.
 * ⚠ A marker could not have saved this read — the answer IS the map, so there is
 * nothing to aggregate and {@link readAllPages} is the fix.
 *
 * ⚠ **THE ORDER IS NEW AND TOTAL: `workspace_members.id` IS THE PRIMARY KEY** (a
 * surrogate `UUID`; `(workspace_id, user_id)` is merely UNIQUE). It is ORDERED ON
 * AND NEVER SELECTED — ORDER BY reaches any column of the relation — so the
 * two-column projection is untouched, the precedent `repository-token-spend.ts`
 * set with `session_key`.
 */
export async function listWorkspaceRoles(
  workspaceId: string
): Promise<Map<string, Role>> {
  const out = new Map<string, Role>();
  const { rows } = await readAllPages<{ user_id: string; role: Role }>(
    // ⚠ A FRESH QUERY PER PAGE — one-shot thenable.
    async (from, toInclusive) => {
      const { data, error } = await supabaseAdmin()
        .from("workspace_members")
        .select("user_id, role")
        .eq("workspace_id", workspaceId)
        .eq("status", "active")
        .order("id", { ascending: true })
        .range(from, toInclusive);
      return {
        data: (data ?? []) as unknown as Array<{ user_id: string; role: Role }>,
        error,
      };
    },
    { hardCap: WORKSPACE_ROSTER_LIMIT }
  );
  for (const row of rows) out.set(row.user_id, row.role);
  return out;
}

/** How many runs the token-spend read carries. ⚠ A HARD CAP ON A PAGE WALK now,
 *  not a `.limit()`: it is above `max_rows`, so as a single-statement limit it
 *  silently became 1,000 and the strip lost every run before that (#2935). */
const TOKEN_SPEND_LIMIT = 2_000;

/**
 * THE CALLER'S OWN TOKEN SPEND IN THIS CONTAINER, newest run first.
 *
 * 🔒 **BOTH FENCES, AND THE `user_id` ONE IS NOT NEGOTIABLE. There is no
 * workspace-wide variant of this function and there must not be one** —
 * INVARIANTS §9 carries the argument.
 *
 * ⚠ A MISSING LEDGER DEGRADES TO AN EMPTY LIST: absent and empty both mean "no
 * spend is recorded for you here".
 *
 * 🔒 **PAGED, BECAUSE THE ANSWER IS THE LIST ITSELF (#2935).** Every row is a
 * MARK on the strip — nothing is summed, so no aggregate can help — and a
 * `.limit(2_000)` was declined down to `max_rows` = 1,000 with no error, which on
 * a busy month silently deleted the oldest runs from a 31-day strip. The walk
 * fetches pages the server will actually return and keeps
 * {@link TOKEN_SPEND_LIMIT} as its reported hard cap.
 *
 * ⚠ **THE ORDER IS TOTAL, WHICH IS WHAT MAKES PAGING SOUND.** `started_at` alone
 * is not unique (two runs can start in the same millisecond), and paging a
 * non-unique ORDER BY lets Postgres return one row twice and skip another.
 * `session_key` is the tie-break: `(workspace_id, user_id, session_key,
 * started_at)` is this table's PRIMARY KEY and the first two are pinned by the
 * `eq`s above, so `(started_at, session_key)` is unique within the result.
 */
export async function listWorkspaceTokenSpend(
  workspaceId: string,
  userId: string,
  sinceIso: string
): Promise<UsageScan<{ started_at: string; tokens: number }>> {
  try {
    return await readAllPages<{ started_at: string; tokens: number }>(
      // ⚠ A FRESH QUERY PER PAGE. A Supabase builder is a one-shot thenable;
      // re-awaiting one re-sends the first range and the walk spins on page 0.
      (from, toInclusive) =>
        supabaseAdmin()
          .from("workspace_token_spend")
          .select("started_at, tokens")
          .eq("workspace_id", workspaceId)
          .eq("user_id", userId)
          .gte("started_at", sinceIso)
          .order("started_at", { ascending: false })
          .order("session_key", { ascending: true })
          .range(from, toInclusive),
      { hardCap: TOKEN_SPEND_LIMIT }
    );
  } catch (error) {
    // ⚠ **NARROWED TO "THE LEDGER IS NOT THERE", AND THAT IS NARROWER THAN THE
    // LINE IT REPLACES.** The old `if (error)` degraded on ANY error while its own
    // comment said "a MISSING ledger"; the walk THROWS what a page answered, and a
    // `catch` is exactly where a narrow rule gets widened by accident. A
    // permission error means UNKNOWN, never NONE — swallowing 42501 draws an empty
    // strip for an operator whose spend is merely unreadable. Same three codes,
    // same ruling, as `channels/server/repository-token-spend.ts`.
    const code = (error as { code?: string } | null)?.code ?? "";
    if (!LEDGER_ABSENT_CODES.has(code)) throw error;
    console.warn(
      `[workspaces/overview] token ledger unreadable, degrading to empty: ${
        (error as { message?: string } | null)?.message ?? String(error)
      }`
    );
    return { rows: [], truncated: false };
  }
}
