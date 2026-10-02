import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { MCP_CALL_ROWS } from "@/features/analytics/server/mcp-tool-calls";
import type { Role } from "@/features/workspaces/types";

/**
 * Pure data access for the /home Overview face: exact head-counts, two bounded
 * scans, and the per-bin counter behind the histogram.
 *
 * ⚠ **EVERY FUNCTION TAKES `workspaceIds` AND THAT ARRAY IS THE ENTIRE FENCE.**
 * The admin client BYPASSES RLS (INVARIANTS §2), so never pass an id a caller
 * sent; the service builds it from `repository-containers.ts ›
 * listLinkContainers` (the user-fence of §9's home bullet).
 *
 * ⚠ An empty `workspaceIds` short-circuits to zero/empty without a round trip.
 *
 * ⚠ `listOwnedHomeSpaceIds` and `scanCreditEvents` are fenced on the reader's OWN
 * user id instead — a second fence, not an exception (2026-09-12): a wallet
 * belongs to a person, and credit surfaces follow ownership, not membership.
 * Both fences are derived from the session.
 *
 * ⚠ The admin client is untyped here (see `workspaces/server/repository-overview.ts`):
 * the generated `Database` type lacks the channels tables, `workspace_credit_usage`
 * and `workspaces.kind`, so results are cast at the boundary.
 */

/**
 * De Morgan of `NOT (tool = 'channel' AND op LIKE 'await%')`.
 *
 * ⚠ Deliberately copied in shape from `workspaces/server/repository-overview.ts ›
 * countMcpCallsInWindow` (§2 forbids importing another feature's repository).
 * The await ops POLL — a row per tick — and unfiltered they dominate every histogram.
 */
const EXCLUDE_AWAIT_POLLING = "tool.neq.channel,op.not.like.await*";

/**
 * Ceiling on a breakdown SCAN. ⚠ A scan AT its ceiling is indistinguishable from
 * an exhausted one, so callers return `truncated` and the surface says so (§9).
 * Newest first, so a clip narrows the window rather than zeroing old bins.
 */
const HOME_SCAN_LIMIT = 20_000;

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

/* ⚠ The stat-tile head-counts were deleted with their tiles (Samuel, 2026-09-01):
   a read with no reader is a read nobody re-verifies. */

/**
 * ONE BIN of the histogram, counted rather than scanned — the page's only exact read.
 *
 * ⚠ Counted per bin, never hauled and grouped: a hauling read needs a `limit`,
 * and a clipped series renders its oldest bins as ZERO rather than as clipped
 * (cf. `workspaces/server/repository-overview.ts › countMessagesInWindow`).
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
    .or(EXCLUDE_AWAIT_POLLING)
    .not("tool", "like", MCP_CALL_ROWS);
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
 * ⚠ Four columns, newest first, capped: the sanctioned haul-and-tally shape
 * (§9), with the scanned count as the shares' denominator. PostgREST cannot
 * `GROUP BY`, and a `SECURITY DEFINER` binning RPC is ruled out by INVARIANTS §9.
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
    .not("tool", "like", MCP_CALL_ROWS)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return clipped((data ?? []) as McpCallScanRow[], limit);
}

/**
 * Which container each message in the window landed in — one column, for the
 * per-channel bar's message figure.
 *
 * ⚠ No body, author or id: this read is only counted by group (§9).
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
  /** Which counter moved — `personal` | `seat` | `workspace` (LEGACY, the column
   *  `DEFAULT`, on every pre-2026-09-07 row). ⚠ Half the personal-wallet
   *  predicate; see {@link scanCreditEvents}. */
  wallet: string;
  /** THE PAYER — the person whose wallet moved. `null` on legacy rows (the
   *  payer was a workspace then) and on a deleted account (`SET NULL`). */
  payer_user_id: string | null;
  /**
   * 🔒 **The channel that was BILLED — rule B's dimension, keyed by the Usage
   * dropdown (2026-09-13).** `null` = **Desktop agent**: channel-less MCP, an app
   * click, a hard-deleted channel, or a row predating
   * `20261003120000_credit_events_channel.sql`.
   * ⚠ Not derivable from `origin_workspace_id` — that is where the call was
   * ADDRESSED (`billing/server/credit-ledger.ts › CreditUsageEvent`).
   */
  channel_id: string | null;
  amount: number;
  created_at: string;
}

/**
 * Container kinds whose burns land on the OWNER's personal wallet —
 * `credits-service.ts › resolveBillingTarget`'s non-`standard` arms, as
 * `scripts/sql/backfill-credit-wallets-v2.sql` maps them. ⚠ Fences the LEGACY
 * arm only; a `standard` burn is a SEAT wallet's.
 */
const PERSONAL_WALLET_KINDS = ["home", "link"];

/**
 * Every container whose burns charge `userId`'s PERSONAL wallet — their own
 * `kind='home'` container and every `kind='link'` container they OWN.
 *
 * 🔒 **OWNERSHIP, NOT MEMBERSHIP.** `listLinkContainers` (every other read's
 * fence) includes joined channels whose burns spend the OWNER's wallet; this is
 * `workspaces.owner_id = caller`. ⚠ Derived from the session user id only, which
 * is what lets it reach the admin client (INVARIANTS §2).
 */
export async function listOwnedHomeSpaceIds(
  userId: string
): Promise<string[]> {
  const { data, error } = await supabaseAdmin()
    .from("workspaces")
    .select("id")
    .eq("owner_id", userId)
    .in("kind", PERSONAL_WALLET_KINDS);
  if (error) throw error;
  return ((data ?? []) as { id: string }[]).map((row) => row.id);
}

/**
 * The histogram's channel narrowing — one channel, or the Desktop-agent bucket.
 *
 * 🔒 **These two plus "no narrowing" PARTITION the wallet's rows exactly — rule B
 * (Samuel, 2026-09-13: "the wallet needs to match the histogram").** ⚠ A
 * container id is not a valid scope (an origin fence leaks rows both ways); a
 * channel is named by `HomeChannel.channelId`.
 */
export type CreditChannelScope = { channelId: string } | "unattributed";

/**
 * THE CREDIT LEDGER, fenced to rows out of the READER'S OWN PERSONAL WALLET —
 * the one read behind credits by channel, credits by person and the credit
 * histogram.
 *
 * 🔒 **THE FENCE IS THE WALLET, NOT THE CONTAINER SET (Samuel, 2026-09-12)**, so
 * this sums the same quantity Settings › Plans & billing prints. A
 * membership-container fence mixed in other people's SEAT-wallet burns.
 *
 * ⚠ Two arms, matching `scripts/sql/backfill-credit-wallets-v2.sql` and
 * `credits-service.ts › resolveBillingTarget`:
 *   1. `payer_user_id = reader AND wallet = 'personal'` — every v2.1 row.
 *   2. `wallet = 'workspace' AND origin_workspace_id IN (reader's own
 *      personal/link containers)` — pre-2026-09-07 rows with no payer; the
 *      payer is derived from the origin's owner, as the backfill does.
 * A `seat` row matches neither: it belongs to that workspace's Overview page.
 *
 * ⚠ No `workspaceIds`, so no empty short-circuit: arm 1 is keyed on a person.
 * Arm 2 is dropped when the owned list is empty (PostgREST has no empty
 * `in.()`). Both arms come from the session user id and ids read here, never
 * from a caller (§2).
 *
 * ⚠ The channel dimension is `channel_id` (rule B), not `origin_workspace_id`
 * (where the call was ADDRESSED); rails and histogram key on it
 * (`overview-tally.ts › tallyChannels`).
 *
 * ⚠ A sum with no `SUM`: PostgREST cannot aggregate, so the service adds the
 * hauled rows (§9). `amount` is read though it is 1 per call today — the cost is
 * a tunable (`credits.ts › CREDITS_PER_MCP_CALL`).
 *
 * ⚠ A FLOOR only because of the cap: rows are written inside the wallet RPC's
 * transaction (F-693), so none can be missing — but a clip can.
 */
export async function scanCreditEvents(
  userId: string,
  ownedContainerIds: string[],
  sinceIso: string,
  /**
   * Narrowings INSIDE the fence above — never a widening, never a fence of their
   * own (2026-09-13, Usage histogram month arrows + scope dropdown).
   *
   * ⚠ **`channel` is an `AND` on top of the `.or()`**, so the wallet arms still
   * decide which rows exist. That is why a CALLER-SUPPLIED channel id (parsed by
   * `overview-series-params.ts › parseUsageScope`) needs no ownership check: it
   * can only hide the reader's own rows.
   * ⚠ **`untilIso` is load-bearing for a past month**: the scan is newest-first
   * and capped, so an unbounded haul anchored in an old month returns this
   * month's rows and plots zeroes with no clip reported.
   */
  opts: {
    untilIso?: string;
    channel?: CreditChannelScope;
    limit?: number;
  } = {}
): Promise<Scan<CreditEventScanRow>> {
  const limit = opts.limit ?? HOME_SCAN_LIMIT;
  const legacyArm =
    ownedContainerIds.length > 0
      ? `,and(wallet.eq.workspace,origin_workspace_id.in.(${ownedContainerIds.join(",")}))`
      : "";
  let query = supabaseAdmin()
    .from("credit_usage_events")
    .select(
      "origin_workspace_id, user_id, wallet, payer_user_id, channel_id, amount, created_at"
    )
    .or(`and(payer_user_id.eq.${userId},wallet.eq.personal)${legacyArm}`)
    .gte("created_at", sinceIso);
  if (opts.untilIso) query = query.lt("created_at", opts.untilIso);
  if (opts.channel) {
    // ⚠ `IS NULL` and `eq` are one narrowing: the Desktop-agent bucket IS "no
    // channel", so special-casing only one leaks the other's rows.
    query =
      opts.channel === "unattributed"
        ? query.is("channel_id", null)
        : query.eq("channel_id", opts.channel.channelId);
  }
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    // 🔒 **The only read on this page that degrades instead of throwing:
    // migration lag.** `credit_usage_events` (`20260901120000_credit_usage_events.sql`)
    // and its `wallet`/`payer_user_id`/`channel_id` columns (`20260930120000` §4,
    // `20261003120000_credit_events_channel.sql`) ship unapplied; until Samuel
    // applies them PostgREST answers `42P01`/`42703`, and rethrowing would 500
    // `getHomeOverview`'s whole `Promise.all`.
    // ⚠ EMPTY, not a container-fence fallback (that resurrects the two-counter bug).
    // ⚠ **Safe here and only here**: an empty ledger is already a truthful state
    // ("nothing yet"); no other read here has one, so none may copy this.
    // ⚠ Logged, never silent: a quiet unmetered surface looks like a quiet month.
    console.warn(
      `[home/overview] credit ledger unreadable, degrading to empty: ${error.message}`
    );
    return { rows: [], truncated: false };
  }
  return clipped((data ?? []) as CreditEventScanRow[], limit);
}

/**
 * `(workspaceId, userId) → role` across the fence — THE guest/member split.
 *
 * 🔒 **Only `workspace_members` can answer this**: `channel_members.role` has no
 * `guest` arm, so it would report every guest as a member (cf.
 * `channels/server/dto.ts`).
 *
 * ⚠ `status = 'active'` (as `listContainerPeers`). Someone who has left keeps
 * their calls in the breakdown with a `null` role rather than being dropped.
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
