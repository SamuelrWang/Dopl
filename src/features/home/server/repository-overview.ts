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
 * ⚠ **TWO FUNCTIONS TAKE A PERSON INSTEAD, AND THAT IS A SECOND FENCE RATHER
 * THAN AN EXCEPTION TO THE FIRST (2026-09-12).** `listOwnedPersonalContainerIds`
 * and `scanCreditEvents` are fenced on the reader's OWN USER ID, because the
 * thing they answer for is a WALLET and a wallet belongs to a person, not to a
 * container set. Membership and ownership are different lists (see that
 * function), and the credit surfaces follow ownership. Both fences are derived
 * server-side from the session; neither may ever take an id a caller sent.
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
  /** WHICH COUNTER MOVED — `personal` | `seat` | `workspace` (the LEGACY pooled
   *  value, which is the column's `DEFAULT`, so every pre-2026-09-07 row carries
   *  it). ⚠ Read because it is half the personal-wallet predicate; see
   *  {@link scanCreditEvents}. */
  wallet: string;
  /** THE PAYER — the person whose wallet moved. `null` on legacy rows (the
   *  payer was a workspace then) and on a deleted account (`SET NULL`). */
  payer_user_id: string | null;
  /**
   * 🔒 **THE CHANNEL THAT WAS BILLED — RULE B's dimension, which the Usage card's
   * dropdown keys on (2026-09-13).** `null` = **Desktop agent**: a channel-less
   * MCP connection, an app click, a HARD-deleted channel (`ON DELETE SET NULL`),
   * and every row written before `20261003120000_credit_events_channel.sql`.
   * ⚠ **NOT DERIVABLE FROM `origin_workspace_id`** — that is where the call was
   * ADDRESSED, which differs whenever an agent reaches across containers
   * (`billing/server/credit-ledger.ts › CreditUsageEvent`).
   */
  channel_id: string | null;
  amount: number;
  created_at: string;
}

/**
 * The two container kinds whose burns land on the OWNER's PERSONAL wallet — i.e.
 * `credits-service.ts › resolveBillingTarget`'s two non-`standard` arms, restated
 * for a read, and the same `CASE` the deploy-day backfill runs
 * (`scripts/sql/backfill-credit-wallets-v2.sql`). ⚠ It fences the LEGACY arm of
 * the wallet predicate only; a `standard` workspace's burn is a SEAT wallet's.
 */
const PERSONAL_WALLET_KINDS = ["personal", "link"];

/**
 * Every container whose burns are charged to `userId`'s PERSONAL wallet — their
 * own `kind='personal'` container and every `kind='link'` container they OWN.
 *
 * 🔒 **OWNERSHIP, NOT MEMBERSHIP, AND THE TWO ARE DIFFERENT FENCES ON THIS
 * PAGE.** `repository-containers.ts › listLinkContainers` (the fence every other
 * read here uses) is `workspace_members.user_id = caller` — it includes the
 * channels somebody ELSE owns and the caller merely joined, and a burn in one of
 * those spends the OWNER's wallet, never the reader's. This list is the
 * complement: `workspaces.owner_id = caller`, which is what the wallet follows.
 * ⚠ It is derived from the SESSION user id and nothing a caller sent, which is
 * what lets it be handed to the RLS-bypassing admin client (INVARIANTS §2).
 */
export async function listOwnedPersonalContainerIds(
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
 * THE HISTOGRAM'S CHANNEL NARROWING — one channel, or the Desktop-agent bucket.
 *
 * 🔒 **THESE TWO PLUS "no narrowing" PARTITION THE WALLET'S ROWS EXACTLY, WHICH IS
 * THE POINT OF RULE B (Samuel, 2026-09-13: "the wallet needs to match the
 * histogram").** Every row has a `channel_id` or has none, so every credit the
 * wallet charged sits in exactly one bucket of the scope dropdown and the buckets
 * sum to the wallet. ⚠ **THE SUPERSEDED `origin_workspace_id IN (owned
 * containers)` LEAKED BOTH WAYS**: a home-channel agent's burn against a STANDARD
 * workspace was in no bucket, and neither was a NULL origin (a deleted
 * container). ⚠ A CONTAINER id is no longer a valid scope — a channel is named by
 * its own id (`HomeChannel.channelId`).
 */
export type CreditChannelScope = { channelId: string } | "unattributed";

/**
 * THE CREDIT LEDGER, fenced to the rows that came out of the READER'S OWN
 * PERSONAL WALLET — the ONE read behind "credits by channel", "credits by
 * person" and the credit histogram.
 *
 * 🔒 **THE FENCE IS THE WALLET, NOT THE CONTAINER SET (Samuel, 2026-09-12: "is
 * the credits usage wired in? I want to make sure").** It used to be
 * `origin_workspace_id IN (every link container the reader is a MEMBER of)`,
 * which sums a DIFFERENT quantity from the one Settings › Plans & billing
 * prints: Samuel's bar said `416 of 500` over a wallet reading `0 of 500`,
 * because his 472 ledger credits for the period split 416 in a link container
 * (his personal wallet under v2.1) and 56 in a standard workspace (a SEAT
 * wallet, somebody else's meter entirely). Two counters, two definitions, one
 * card. **Both surfaces answer one question now — "what came out of MY personal
 * wallet" — and this predicate is that question in SQL.**
 *
 * ⚠ **TWO ARMS, AND THE SECOND ONE IS THE LEGACY SHAPE.** Exactly the mapping
 * `scripts/sql/backfill-credit-wallets-v2.sql` applies, and
 * `credits-service.ts › resolveBillingTarget` writes:
 *   1. `payer_user_id = reader AND wallet = 'personal'` — every row the v2.1
 *      code writes, wherever the call was made.
 *   2. `wallet = 'workspace' AND origin_workspace_id IN (the reader's OWN
 *      personal/link containers)` — pre-2026-09-07 rows, which carry the column
 *      `DEFAULT` and no payer at all, so the payer is DERIVED from the origin
 *      container's owner, the way the backfill derives it.
 * A `seat` row is matched by NEITHER arm and that is the whole fix: a burn in a
 * standard workspace belongs to THAT workspace's Overview page.
 *
 * ⚠ **NO `workspaceIds` AND THEREFORE NO EMPTY SHORT-CIRCUIT.** Arm 1 is keyed on
 * a PERSON, so a reader with no home channels still has a wallet and an honest
 * answer; arm 2 is dropped from the `.or()` when the owned list is empty, because
 * PostgREST has no syntax for an empty `in.()`. ⚠ Both arms are built from the
 * SESSION user id and from ids this repository read itself — never from anything a
 * caller sent, the rule the admin client makes non-negotiable (§2).
 *
 * ⚠ **THE CHANNEL DIMENSION IS `channel_id` SINCE 2026-09-13 (rule B), NOT
 * `origin_workspace_id`** — the origin is where the call was ADDRESSED, which is
 * a different row from the channel that was BILLED whenever an agent reaches
 * across containers. Both are read; the rails and the histogram key on the
 * channel (`overview-tally.ts › tallyChannels`).
 *
 * ⚠ **A SUM WITH NO `SUM`.** PostgREST cannot aggregate, so this hauls the
 * window's rows and the service adds them up — the sanctioned haul-and-tally
 * shape (§9), with the scanned count travelling beside the shares. `amount` is
 * 1 per MCP tool call today, so the row count and the sum coincide; the column
 * is read anyway, because the cost is a tunable (`credits.ts ›
 * CREDITS_PER_MCP_CALL`) and a reader that assumed 1 would silently misreport
 * the day it changes.
 *
 * ⚠ **A FLOOR, AND SINCE 2026-09-13 THE CAP IS THE ONLY REASON.** ⚠ **THE
 * SUPERSEDED LINE SAID "TWICE OVER … the writer is fire-and-forget", AND THAT
 * HALF IS DEAD** (F-693): the row is written by the wallet RPC inside the
 * counter's transaction, so no row can be missing — but a clip still can.
 */
export async function scanCreditEvents(
  userId: string,
  ownedContainerIds: string[],
  sinceIso: string,
  /**
   * NARROWINGS INSIDE THE FENCE ABOVE — never a widening, and never a fence of
   * their own (2026-09-13, the Usage histogram's month arrows + scope
   * dropdown).
   *
   * ⚠ **`channel` IS AN `AND` ON TOP OF THE `.or()`** — PostgREST composes a
   * second filter as a conjunction, so the WALLET ARMS still decide which rows
   * EXIST and this only hides some of them. That is what makes it safe to pass a
   * CALLER-SUPPLIED channel id (parsed by `overview-series-params.ts ›
   * parseUsageScope`, uuid-shaped) with no ownership intersection in front of it:
   * the rows it can reach are already fenced to the reader's own wallet by
   * `payer_user_id`, so the narrowing can only HIDE the reader's rows, never
   * reveal anybody else's. ⚠ The superseded `originIds` narrowing DID need that
   * intersection: a container id is an ADDRESSING input.
   * ⚠ **`untilIso` IS LOAD-BEARING FOR A PAST MONTH, NOT AN OPTIMISATION.** This
   * scan is newest-first and capped, so an unbounded haul anchored in an OLD
   * month returns THIS month's 20k rows and the plotted month bins to zeroes with
   * no clip to report. Bounding it makes `truncated` true instead.
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
    // ⚠ `IS NULL` AND `eq` ARE THE SAME NARROWING, NOT TWO FEATURES: the
    // Desktop-agent bucket IS "no channel", so a reader that special-cased only
    // one of them would leave the other's rows on every filtered view.
    query =
      opts.channel === "unattributed"
        ? query.is("channel_id", null)
        : query.eq("channel_id", opts.channel.channelId);
  }
  const { data, error } = await query
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
    // ⚠ THE SAME DEGRADE COVERS `wallet` / `payer_user_id` / `channel_id`, which
    // arrive in two LATER unapplied migrations (`20260930120000` §4 and
    // `20261003120000_credit_events_channel.sql`): before those applies, a select
    // naming them answers `42703` and this arm answers empty rather than 500ing
    // the face. ⚠ EMPTY, not "the old sum" — a fallback to the container fence
    // would quietly resurrect the two-counter bug this read exists to end.
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
