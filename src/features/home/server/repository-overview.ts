import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { Role } from "@/features/workspaces/types";

/**
 * Pure data access for the /home Overview face: exact head-counts, two bounded
 * scans, and the per-bin counter behind the histogram.
 *
 * ⚠ **EVERY FUNCTION TAKES `workspaceIds` AND THAT ARRAY IS THE ENTIRE FENCE.**
 * These run on the service-role admin client, which BYPASSES RLS (INVARIANTS
 * §2), so nothing below may ever be handed an id a caller sent. The service
 * builds the list from `repository-containers.ts › listLinkContainers`, i.e.
 * `workspace_members.user_id = caller AND workspaces.kind = 'link'` — the same
 * user-fence `getHomeChannels` enters through (§9's home bullet).
 *
 * ⚠ **AN EMPTY `workspaceIds` SHORT-CIRCUITS TO ZERO/EMPTY, IT DOES NOT QUERY.**
 * PostgREST's `.in()` with `[]` matches NOTHING, so the answer would be the
 * same — but a caller with no home channels is the common first state and it
 * should not cost a round trip.
 *
 * ⚠ THE ADMIN CLIENT IS UNTYPED HERE for the reason
 * `workspaces/server/repository-overview.ts` gives: the generated `Database`
 * type does not carry the channels tables (nor `workspace_credit_usage`, nor
 * `workspaces.kind`), so results are cast at the boundary.
 */

/**
 * De Morgan of `NOT (tool = 'channel' AND op LIKE 'await%')`.
 *
 * ⚠ **COPIED IN SHAPE FROM `workspaces/server/repository-overview.ts ›
 * countMcpCallsInWindow`, DELIBERATELY, AND IT IS ONE CONSTANT HERE.** The two
 * features cannot share a module without one importing the other's repository
 * (§2 forbids it), so what is shared is the SENTENCE, stated once per feature.
 * `dopl_channel`'s await ops POLL — one logical "wait for a reply" writes a row
 * per tick — and unfiltered they dominate every histogram this page draws.
 */
const EXCLUDE_AWAIT_POLLING = "tool.neq.channel,op.not.like.await*";

/**
 * Ceiling on a breakdown SCAN. ⚠ A scan AT its ceiling is indistinguishable
 * from an exhausted one, so every caller returns `truncated` beside the rows
 * and the surface says so (§9). Ordered NEWEST FIRST so a clip NARROWS the
 * window the shares describe rather than inventing a zero for an old bin —
 * the trade `listRecentUserMessageAuthors` documents.
 */
export const HOME_SCAN_LIMIT = 20_000;

/* ⚠ `HOME_SESSION_LIMIT` (2,000) LIVED HERE AND IS DELETED WITH ITS ONE READER
   (`listSessionTokens`, 2026-09-01). The two session reads that remain take a
   caller-supplied limit, because both are RENDER lists with a row budget rather
   than abuse bounds over a scan. */

/** `[startIso, endIso)`. */
export interface HomeWindow {
  startIso: string;
  endIso: string;
}

/** A scan that came back AT its ceiling is a FLOOR, and says so. */
export interface Scan<T> {
  rows: T[];
  truncated: boolean;
}

function clipped<T>(rows: T[], limit: number): Scan<T> {
  return { rows, truncated: rows.length >= limit };
}

/* ------------------------------- counts -------------------------------- */

/**
 * ⚠ **THE FIVE HEAD-COUNTS THAT STOOD HERE ARE DELETED (Samuel, 2026-09-01).**
 * `countMcpCallsSince`, `countMessagesSince`, `countThreadsSince`,
 * `countSessions` and `listSessionTokens` existed for ONE consumer — the row of
 * stat tiles at the top of the Overview face — and that row is gone. They are
 * removed rather than left exported: a read with no reader is a read nobody
 * re-verifies, and the token one carried a load-bearing `user_id` fence that
 * only made sense beside the card printing its denominator.
 *
 * ⚠ **`countMetricInWindow` BELOW IS NOT ONE OF THEM** — it is the histogram's
 * per-bin counter and it is still the page's only exact read.
 */

/**
 * ONE BIN of the histogram, counted rather than scanned.
 *
 * ⚠ **COUNTED PER BIN, NEVER HAULED AND GROUPED**, and the reason is
 * `workspaces/server/repository-overview.ts › countMessagesInWindow`'s: a
 * hauling read needs a `limit`, and a clipped series does NOT render as
 * clipped — its oldest bins render as ZERO, which is a measurement nobody took
 * drawn as fact. Counting per bin has no such cliff.
 */
export async function countMetricInWindow(
  workspaceIds: string[],
  win: HomeWindow,
  metric: "mcp" | "messages"
): Promise<number> {
  if (workspaceIds.length === 0) return 0;
  const db = supabaseAdmin();
  if (metric === "messages") {
    const { count, error } = await db
      .from("channel_messages")
      .select("id", { count: "exact", head: true })
      .in("workspace_id", workspaceIds)
      .eq("kind", "message")
      .gte("created_at", win.startIso)
      .lt("created_at", win.endIso);
    if (error) throw error;
    return count ?? 0;
  }
  const { count, error } = await db
    .from("mcp_tool_calls")
    .select("id", { count: "exact", head: true })
    .in("workspace_id", workspaceIds)
    .gte("created_at", win.startIso)
    .lt("created_at", win.endIso)
    .or(EXCLUDE_AWAIT_POLLING);
  if (error) throw error;
  return count ?? 0;
}

/* -------------------------------- scans -------------------------------- */

export interface McpCallScanRow {
  workspace_id: string;
  user_id: string | null;
  tool: string;
  op: string;
}

/**
 * The ONE read behind THREE breakdowns — per channel, per person, per tool.
 *
 * ⚠ FOUR COLUMNS, NEWEST FIRST, CAPPED. This is the sanctioned haul-and-tally
 * shape (§9): it produces SHARES, and the scanned row count travels with them
 * as the denominator. Three separate grouped reads would be three scans of the
 * same rows, and PostgREST cannot `GROUP BY` — the alternative is a
 * `SECURITY DEFINER` binning RPC, which INVARIANTS §9 rules out by name because
 * a route calling an RPC the migration gate has not created is BROKEN rather
 * than slow.
 */
export async function scanMcpCalls(
  workspaceIds: string[],
  sinceIso: string,
  limit: number = HOME_SCAN_LIMIT
): Promise<Scan<McpCallScanRow>> {
  if (workspaceIds.length === 0) return { rows: [], truncated: false };
  const { data, error } = await supabaseAdmin()
    .from("mcp_tool_calls")
    .select("workspace_id, user_id, tool, op")
    .in("workspace_id", workspaceIds)
    .gte("created_at", sinceIso)
    .or(EXCLUDE_AWAIT_POLLING)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return clipped((data ?? []) as McpCallScanRow[], limit);
}

/**
 * Which container each message in the window landed in — ONE column, so the
 * per-channel bar has a message figure beside its MCP one.
 *
 * ⚠ NO BODY, NO AUTHOR, NO ID. This read exists to be COUNTED BY GROUP; every
 * other column would put content on the wire for a figure that never renders
 * it (§9).
 */
export async function scanMessageChannels(
  workspaceIds: string[],
  sinceIso: string,
  limit: number = HOME_SCAN_LIMIT
): Promise<Scan<{ workspace_id: string }>> {
  if (workspaceIds.length === 0) return { rows: [], truncated: false };
  const { data, error } = await supabaseAdmin()
    .from("channel_messages")
    .select("workspace_id")
    .in("workspace_id", workspaceIds)
    .eq("kind", "message")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return clipped((data ?? []) as Array<{ workspace_id: string }>, limit);
}

export interface CreditEventScanRow {
  origin_workspace_id: string | null;
  user_id: string | null;
  amount: number;
  created_at: string;
}

/**
 * THE CREDIT LEDGER, fenced to the caller's containers — the ONE read behind
 * "credits by channel", "credits by person" and the credit histogram
 * (2026-09-01, closing F-328's UI half).
 *
 * ⚠ **FENCED ON `origin_workspace_id`, NOT `workspace_id`, AND THE DIFFERENCE
 * IS THE WHOLE POINT.** `workspace_id` on this table is the PAYER — for a home
 * container that is the owner's billing workspace, which is not a channel and
 * is not in this page's fence. `origin_workspace_id` is WHERE the call was
 * made, i.e. the container, and a container holds exactly one channel
 * (`repository-containers.ts › listContainerChannels`). Fencing on the payer
 * would show the operator their workspace's whole burn under a channel heading.
 *
 * ⚠ **A SUM WITH NO `SUM`.** PostgREST cannot aggregate, so this hauls the
 * window's rows and the service adds them up — the sanctioned haul-and-tally
 * shape (§9), with the scanned count travelling beside the shares. `amount` is
 * 1 per MCP tool call today, so the row count and the sum coincide; the column
 * is read anyway, because the cost is a tunable (`credits.ts ›
 * CREDITS_PER_MCP_CALL`) and a reader that assumed 1 would silently misreport
 * the day it changes.
 *
 * ⚠ **THE ANSWER IS A FLOOR, TWICE OVER.** The writer is fire-and-forget
 * (`billing/server/credit-ledger.ts`) so rows may be missing, and this scan is
 * capped so it may clip. Neither is a reason to hide the figure; both are a
 * reason the surface must not call it exact.
 */
export async function scanCreditEvents(
  workspaceIds: string[],
  sinceIso: string,
  limit: number = HOME_SCAN_LIMIT
): Promise<Scan<CreditEventScanRow>> {
  if (workspaceIds.length === 0) return { rows: [], truncated: false };
  const { data, error } = await supabaseAdmin()
    .from("credit_usage_events")
    .select("origin_workspace_id, user_id, amount, created_at")
    .in("origin_workspace_id", workspaceIds)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    // 🔒 **THE ONLY READ ON THIS PAGE THAT DEGRADES INSTEAD OF THROWING, AND
    // THE REASON IS THE MIGRATION LAG.** `credit_usage_events` ships as an
    // UNAPPLIED migration (`20260901120000_credit_usage_events.sql`) — Samuel
    // applies it — so between deploy and apply the table DOES NOT EXIST and
    // PostgREST answers `42P01`. Rethrowing took the whole Overview face down
    // with it: this read sits in `getHomeOverview`'s `Promise.all`, so one
    // missing table 500'd the payload behind every panel, AND it is the
    // `credits` series arm, which is what blanked the histogram.
    // ⚠ **DEGRADED IS SAFE HERE AND ONLY HERE.** An empty ledger is already an
    // expected state (the table starts with no history), so "no rows" is a
    // reading this surface must render correctly anyway — it says "nothing yet"
    // rather than drawing zeroes. No other read on this page has a truthful
    // empty answer, which is why none of them may copy this.
    // ⚠ LOGGED, never silent: an unmetered surface that says nothing is
    // indistinguishable from a quiet month.
    console.warn(
      `[home/overview] credit ledger unreadable, degrading to empty: ${error.message}`
    );
    return { rows: [], truncated: false };
  }
  return clipped((data ?? []) as CreditEventScanRow[], limit);
}

export interface ThreadActivityRow {
  id: string;
  workspace_id: string;
  channel_id: string;
  title: string;
  status: string;
  last_activity_at: string | null;
  closed_at: string | null;
}

/**
 * The most RECENTLY ACTIVE threads across the fence.
 *
 * ⚠ **OFF `channel_tasks_activity`, ORDERED BY `last_activity_at`** — the view
 * that already exists for exactly this question, and the same one
 * `channels/server/repository-tasks.ts › listTasksByChannel` was moved onto
 * (INVARIANTS §9). Ordering the base table by `updated_at` would answer "last
 * TOUCHED", which a status change or a rename satisfies without anybody saying
 * anything in the thread.
 *
 * ⚠ NAMED COLUMNS, NEVER `*`: the view carries `outcome_summary` and
 * `client_msg_id`, neither of which this list renders, and a summary is content
 * on the wire for a row that shows a title (§9).
 *
 * ⚠ NULLS LAST. A thread that has never had activity has a NULL
 * `last_activity_at`; sorting it to the top would put the quietest rows in a
 * list whose entire premise is recency.
 *
 * ⚠ **`sinceIso` IS A HARD FLOOR, ADDED 2026-09-01 (Samuel: "threads active
 * within the last X minutes").** The panel is about NOW, so a thread quiet for
 * two hours does not belong in it even when the list would otherwise be empty —
 * an empty "recent" panel is the honest answer to a quiet afternoon, and
 * back-filling it with stale rows is how a glance surface starts lying about
 * activity. ⚠ The filter is `gte`, which DROPS the null-activity rows the sort
 * above pushes last; that is consistent — a thread with no activity has had none
 * in the window either.
 */
export async function listRecentThreads(
  workspaceIds: string[],
  limit: number,
  sinceIso: string
): Promise<Scan<ThreadActivityRow>> {
  if (workspaceIds.length === 0) return { rows: [], truncated: false };
  const { data, error } = await supabaseAdmin()
    .from("channel_tasks_activity")
    .select("id, workspace_id, channel_id, title, status, last_activity_at, closed_at")
    .in("workspace_id", workspaceIds)
    .gte("last_activity_at", sinceIso)
    .order("last_activity_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw error;
  return clipped((data ?? []) as ThreadActivityRow[], limit);
}

export interface RunningSessionRow {
  id: string;
  workspace_id: string;
  user_id: string;
  /** The thread this session runs in, or `null` for a channel-level launch.
   *  ⚠ CLASSIFIED **PUBLIC** by `20260822150000_channel_sessions_telemetry.sql`
   *  ("which thread. Already on the peer card."), which is why a jump target
   *  can be built from it without widening the operator-only fence. */
  task_id: string | null;
  name: string;
  display_name: string | null;
  state: string;
  detail: string | null;
  channel_name: string | null;
  thread_title: string | null;
  updated_at: string;
}

/**
 * Agent sessions the desktop has not reported as `ended`, newest activity first.
 *
 * 🔒 **PUBLIC COLUMNS ONLY — NOT ONE OF THE SEVEN OPERATOR-ONLY ONES.**
 * The select below is drawn from the PUBLIC half of
 * `20260822150000_channel_sessions_telemetry.sql`'s classification table:
 * identity, whose machine, state, the closed-vocabulary `detail`, the two names
 * and the timestamps. **`model`, `tool_label`, `context_used`,
 * `context_window`, `tokens_spent`, `started_at` and `last_activity_at` are
 * absent and must stay absent.** A home container holds another PERSON, this
 * read runs service-role (so neither the RLS policy nor the column GRANT applies),
 * and the DTO fence that normally protects them
 * (`collab-dto.ts › mapPeerSessionStateRow`) is not on this path — so **the
 * column list IS the fence here**, and it fails closed the way that function
 * does: by naming what may be read rather than omitting what may not.
 *
 * ⚠ `detail` IS PEER-VISIBLE AND ONLY BECAUSE ITS VOCABULARY IS CLOSED (six
 * coarse keys). The renderer must narrow it the way `collab-dto.ts ›
 * narrowSessionDetail` does — an unknown key renders as nothing.
 */
export async function listRunningSessions(
  workspaceIds: string[],
  limit: number
): Promise<Scan<RunningSessionRow>> {
  if (workspaceIds.length === 0) return { rows: [], truncated: false };
  const { data, error } = await supabaseAdmin()
    .from("channel_sessions")
    .select(
      "id, workspace_id, user_id, task_id, name, display_name, state, detail, channel_name, thread_title, updated_at"
    )
    .in("workspace_id", workspaceIds)
    .neq("state", "ended")
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return clipped((data ?? []) as RunningSessionRow[], limit);
}

/**
 * `(workspaceId, userId) → role` across the fence — THE guest/member split.
 *
 * 🔒 **`workspace_members` IS THE ONLY TABLE THAT CAN ANSWER THIS.**
 * `channel_members.role` is `CHECK (role IN ('owner','member'))` and has no
 * `guest` arm at all, so a channel-side read would silently report every guest
 * as a member. `channels/server/dto.ts` states the same rule for the roster.
 *
 * ⚠ REVOKED memberships are excluded and PENDING ones are not members yet —
 * `status = 'active'`, the same predicate `listContainerPeers` uses. A person
 * who has since left keeps their calls in the breakdown with a `null` role;
 * dropping their rows would under-count the traffic that really happened.
 */
export async function listContainerRoles(
  workspaceIds: string[]
): Promise<Map<string, Role>> {
  const out = new Map<string, Role>();
  if (workspaceIds.length === 0) return out;
  const { data, error } = await supabaseAdmin()
    .from("workspace_members")
    .select("workspace_id, user_id, role")
    .in("workspace_id", workspaceIds)
    .eq("status", "active");
  if (error) throw error;
  for (const row of (data ?? []) as Array<{
    workspace_id: string;
    user_id: string;
    role: Role;
  }>) {
    out.set(roleKey(row.workspace_id, row.user_id), row.role);
  }
  return out;
}

/** The composite key {@link listContainerRoles} maps by. ⚠ Exported so the
 *  service cannot spell it a second, drifting way. */
export function roleKey(workspaceId: string, userId: string): string {
  return `${workspaceId}:${userId}`;
}
