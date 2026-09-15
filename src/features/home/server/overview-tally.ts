import type { Role } from "@/features/workspaces/types";
import { agentFaceName } from "@/shared/lib/agent-name";
import type {
  HomeAgentRow,
  HomeChannelUsage,
  HomePersonUsage,
  HomeSeriesPoint,
  HomeToolUsage,
} from "../overview-types";
import {
  roleKey,
  type CreditEventScanRow,
  type HomeWindow,
  type McpCallScanRow,
  type RunningSessionRow,
} from "./repository-overview";

/**
 * The /home Overview face's PURE half — the tallies over scanned rows and the
 * agent row→payload mapper.
 *
 * ⚠ SPLIT OUT OF `service-overview.ts` ON 2026-09-01, when the thread and agent
 * sections took that file past the 500-line cap (§1 —
 * `eslint.config.mjs › max-lines`). The seam is the one the file already had a
 * banner for: **nothing here does IO**, so it is unit-testable without a single
 * mock, and `service-overview.test.ts` covers this module almost entirely.
 *
 * ⚠ **NO `server-only` HERE, DELIBERATELY, AND IT IS STILL SERVER CODE.** It
 * imports row TYPES from the repository (types erase) and nothing that reaches a
 * client. The marker stays on `service-overview.ts` and on the repository, which
 * are the modules that actually touch `supabaseAdmin()`.
 */

/**
 * The six CLOSED situation keys `channel_sessions.detail` may carry.
 *
 * 🔒 **NARROWED ON THE WAY OUT, exactly as `collab-dto.ts ›
 * narrowSessionDetail` does it, and the column's own migration explains why the
 * DB deliberately does NOT `CHECK` this list**: a newer desktop shipping a
 * seventh key must be able to STORE it rather than 400 its whole push, so the
 * closed-value test belongs on the READ side. An unknown key renders as
 * nothing. ⚠ `detail` is the ONE peer-visible telemetry column and it is
 * peer-visible ONLY because this vocabulary is closed — if it ever becomes
 * free-form it becomes private in the same change.
 */
const SESSION_DETAILS: readonly string[] = [
  "thinking",
  "tool",
  "posting",
  "permission",
  "awaiting_peer",
  "awaiting_inbound",
];

export function narrowDetail(raw: string | null): string | null {
  return raw !== null && SESSION_DETAILS.includes(raw) ? raw : null;
}

/** How many `(tool, op)` rows the tools list carries. */
const TOOL_ROWS = 8;

/** How many people the by-person list carries. ⚠ A ceiling on the RENDER, not
 *  on the tally, and the scan denominator travels with it (`scanned`). */
const PERSON_ROWS = 8;

/**
 * Ledger rows → one bar per bin.
 *
 * ⚠ **BINNED BY A HALF-OPEN COMPARISON ON THE ISO STRING'S INSTANT**, not by
 * arithmetic on a day number: the bins are already `[start, end)` pairs and a
 * row belongs to exactly one of them. A row outside every bin (the scan can
 * return one when the window boundary moves between reads) is DROPPED rather
 * than folded into the nearest bar.
 */
export function binCredits(
  rows: CreditEventScanRow[],
  windows: HomeWindow[]
): HomeSeriesPoint[] {
  const points = windows.map((win) => ({ at: win.startIso, count: 0 }));
  for (const row of rows) {
    const at = Date.parse(row.created_at);
    for (let i = 0; i < windows.length; i++) {
      const win = windows[i];
      if (at >= Date.parse(win.startIso) && at < Date.parse(win.endIso)) {
        points[i].count += row.amount;
        break;
      }
    }
  }
  return points;
}

/** How many channels the per-channel comparison carries. */
const CHANNEL_ROWS = 8;

/** Tool + op, as one map key. A tool with no op (`op` defaults to `''`) keys
 *  on the tool alone rather than on a trailing separator. */
function toolKey(tool: string, op: string): string {
  return op ? `${tool}:${op}` : tool;
}

/**
 * `(tool, op)` pairs by call count, descending, capped at {@link TOOL_ROWS}.
 *
 * ⚠ TIES BREAK ON THE KEY, so the list is TOTALLY ordered and does not shuffle
 * between two loads that measured the same numbers.
 */
export function tallyTools(rows: McpCallScanRow[]): HomeToolUsage[] {
  const byPair = new Map<string, HomeToolUsage>();
  for (const row of rows) {
    const key = toolKey(row.tool, row.op);
    const found = byPair.get(key);
    if (found) found.calls += 1;
    else byPair.set(key, { tool: row.tool, op: row.op, calls: 1 });
  }
  return [...byPair.values()]
    .sort(
      (a, b) =>
        b.calls - a.calls ||
        toolKey(a.tool, a.op).localeCompare(toolKey(b.tool, b.op))
    )
    .slice(0, TOOL_ROWS);
}

/**
 * IS THIS LEDGER ROW ONE THE READER'S **PERSONAL WALLET** PAID FOR?
 *
 * 🔒 **THE DEFINITION OF THE /home CREDIT FIGURE, IN ONE PLACE (Samuel,
 * 2026-09-12: "is the credits usage wired in? I want to make sure").** The
 * Overview bar and Settings › Plans & billing must answer the SAME question —
 * *what came out of MY personal wallet this period* — and before this predicate
 * they answered two: the bar summed every container the reader had burned in
 * (416, all of it in one link container) while the wallet counter read what it
 * had actually charged (0 before the deploy-day backfill), with another 56
 * credits of the same period sitting on a SEAT wallet in a standard workspace.
 *
 * ⚠ **TWO ARMS, MIRRORING `credits-service.ts › resolveBillingTarget` AND THE
 * DEPLOY-DAY BACKFILL (`scripts/sql/backfill-credit-wallets-v2.sql`) EXACTLY:**
 *   1. a v2.1 row — `wallet = 'personal'` — is the reader's iff `payer_user_id`
 *      IS the reader. ⚠ On the guest path the payer is NOT the caller, which is
 *      the point: a peer burning credits in the reader's channel spends the
 *      READER's wallet, and that row is theirs even though `user_id` is not.
 *   2. a LEGACY row — `wallet = 'workspace'`, the column's `DEFAULT`, written
 *      before 2026-09-07 with no payer at all — is the reader's iff its ORIGIN
 *      CONTAINER is one they OWN of kind `personal`/`link`, which is how the
 *      backfill derives a payer for exactly those rows.
 * A `seat` row is neither, and a `personal` row somebody ELSE paid for is
 * neither. ⚠ **`wallet` IS NOT NARROWED TO A UNION HERE** — the column has no
 * `CHECK`-closed future and the closed-value test belongs on the read side, the
 * same argument {@link narrowDetail} makes: an unknown wallet is not the
 * reader's, which fails CLOSED.
 *
 * ⚠ **IT IS THE SECOND HALF OF A RULE THE SQL ALSO STATES**, and deliberately so:
 * `repository-overview.ts › scanCreditEvents` pushes the same two arms into
 * PostgREST so the rows never leave the database, and this function is the
 * DEFINITION the tests pin. If the pushdown is ever loosened by a bug, this
 * filter still drops what the pushdown let through — belt and braces that fail
 * in the safe direction. It must never be relaxed to "trust the query".
 */
export function isPersonalWalletBurn(
  row: CreditEventScanRow,
  viewerId: string,
  ownedContainerIds: ReadonlySet<string>
): boolean {
  if (row.wallet === "personal") return row.payer_user_id === viewerId;
  if (row.wallet === "workspace") {
    return (
      row.origin_workspace_id !== null &&
      ownedContainerIds.has(row.origin_workspace_id)
    );
  }
  return false;
}

/**
 * CREDITS per PERSON, descending — the guest breakdown Samuel asked for, now on
 * what was actually CHARGED rather than on loopback-request shape.
 *
 * 🔒 **THE ROWS ARE THE READER'S OWN PERSONAL WALLET'S, SO THIS LIST ANSWERS
 * "WHO BURNED *MY* CREDITS" (2026-09-12).** The caller filters with
 * {@link isPersonalWalletBurn} before this runs, which is what makes the
 * breakdown add up to the capacity bar above it. ⚠ `user_id` is still WHO
 * CALLED, and on the guest path that is not the payer — a peer's name here means
 * they spent the reader's allowance, which is exactly the question the rail was
 * built to answer. Burns in a STANDARD workspace are absent by construction:
 * those are seat wallets and belong to that workspace's own Overview.
 *
 * ⚠ **IT TALLIED `mcp_tool_calls` UNTIL 2026-09-01.** That table counts loopback
 * REQUESTS — `dopl_map` fans out, the await ops poll — so it was never a cost,
 * and `credits.ts` says so from the other side. It now sums the
 * `credit_usage_events` ledger. ⚠ Which means the figure is a FLOOR — **because
 * this scan is CAPPED, and since 2026-09-13 for no other reason**: the
 * superseded line also blamed a fire-and-forget writer, and that writer is gone
 * (F-693, the row is written inside the counter's transaction).
 *
 * ⚠ **A ROW WITH NO `user_id` IS DROPPED, NOT BUCKETED AS "UNKNOWN".** The
 * column is `ON DELETE SET NULL`, so a null means the account is GONE — there is
 * nobody to attribute the spend to, and an "Unknown" row in a per-person
 * breakdown reads as a person.
 *
 * ⚠ `role` is looked up per (container, user) and the FIRST one found wins — a
 * person can be a guest in one home channel and a member of another, and an
 * account-wide list has no honest way to print two. ⚠ A row whose
 * `origin_workspace_id` is null (the container was deleted) can still be
 * attributed to a PERSON, so it counts here with a `null` role rather than being
 * dropped: the spend happened and somebody made it.
 */
export function tallyCreditPeople(
  rows: CreditEventScanRow[],
  roles: Map<string, Role>,
  names: Map<string, string>
): HomePersonUsage[] {
  const byUser = new Map<string, HomePersonUsage>();
  for (const row of rows) {
    if (!row.user_id) continue;
    const roleForRow = row.origin_workspace_id
      ? (roles.get(roleKey(row.origin_workspace_id, row.user_id)) ?? null)
      : null;
    const found = byUser.get(row.user_id);
    if (found) {
      found.credits += row.amount;
      if (found.role === null) found.role = roleForRow;
      continue;
    }
    byUser.set(row.user_id, {
      userId: row.user_id,
      name: names.get(row.user_id) ?? "",
      role: roleForRow,
      credits: row.amount,
    });
  }
  return [...byUser.values()]
    .sort((a, b) => b.credits - a.credits || a.userId.localeCompare(b.userId))
    .slice(0, PERSON_ROWS);
}

/**
 * CREDITS and MESSAGES per home channel, descending by credits.
 *
 * 🔒 **THE CREDIT DIMENSION IS `channel_id` SINCE 2026-09-13 (rule B), MAPPED
 * BACK TO ITS CONTAINER FOR THE ROW KEY.** ⚠ **IT WAS `origin_workspace_id` — the
 * ADDRESSED container — UNTIL THIS WAVE**, on the argument that a container holds
 * exactly one channel; rule B breaks that identity, and the old dimension DROPPED
 * every burn a home channel's agent made against another container (a workspace
 * KB read), i.e. exactly the rows the ruling moved onto that channel's wallet.
 * ⚠ `channelContainers` is `channelId → containerId`, built from the read
 * `resolveScope` already makes (`repository-containers.ts ›
 * listContainerChannels`) — the mapping costs no round trip. A channel outside the
 * reader's fence has no entry and its row is dropped, which is the same fence the
 * `names` map is.
 *
 * 🔒 **AND THE CREDIT ROWS ARE THE READER'S OWN PERSONAL WALLET'S SINCE
 * 2026-09-12** ({@link isPersonalWalletBurn}), so this rail reads "which of MY
 * home channels burned MY wallet". ⚠ A burn with NO calling channel (`channel_id
 * IS NULL` — the Desktop agent) has no channel to sit under and therefore no row
 * here: it is still in the wallet, and the bar above is the wallet. The rail and
 * the bar are two questions, not two answers to one.
 *
 * ⚠ EVERY CHANNEL IN THE FENCE GETS A ROW, including the silent ones — the
 * comparison is "which of MY channels is busy", and dropping the quiet ones
 * turns an answer of "none of them" into an empty list that reads as a failed
 * read. The RENDER cap is {@link CHANNEL_ROWS}.
 */
export function tallyChannels(
  names: Map<string, string>,
  channelContainers: Map<string, string>,
  credits: CreditEventScanRow[],
  messages: Array<{ workspace_id: string }>
): HomeChannelUsage[] {
  const rows = new Map<string, HomeChannelUsage>();
  for (const [workspaceId, name] of names) {
    rows.set(workspaceId, { workspaceId, name, credits: 0, messages: 0 });
  }
  for (const event of credits) {
    const container = event.channel_id
      ? channelContainers.get(event.channel_id)
      : undefined;
    const row = container ? rows.get(container) : undefined;
    if (row) row.credits += event.amount;
  }
  for (const message of messages) {
    const row = rows.get(message.workspace_id);
    if (row) row.messages += 1;
  }
  return [...rows.values()]
    .sort(
      (a, b) =>
        b.credits - a.credits ||
        b.messages - a.messages ||
        a.name.localeCompare(b.name)
    )
    .slice(0, CHANNEL_ROWS);
}

/**
 * Rows → the agent section's shape.
 *
 * 🔒 **CONSTRUCTED, NOT SPREAD — the same discipline `collab-dto.ts ›
 * mapPeerSessionStateRow` states.** Naming each field means a column added to
 * `channel_sessions` (including a new OPERATOR-ONLY one) cannot reach this
 * payload by accident; an omit-list would fail OPEN.
 *
 * ⚠ `mine` REPLACES THE `user_id`, and that is the privacy shape: the caller
 * needs to tell their own agents from a peer's, and does not need the peer's id
 * to do it.
 *
 * ⚠ **`name` FELL BACK TO `channel_sessions.name` UNTIL 2026-09-15, AND THAT COLUMN IS THE RAW
 * AGENT ID** (`main/session-summary.js › nameOf` answers `s.agentId` and nothing else). So the
 * Home pane's agent board printed eight machine characters as the card's title for every agent
 * nobody had named — the same leak `channels/components/agents-model.ts › agentDisplayName`
 * carried on the channels surface, reached through a SERVER projection instead of a component,
 * which is why the `.tsx` source sweep could never have caught it. Samuel, 2026-09-15: *"I want
 * to make it so that the user really doesnt see it"*.
 * ⚠ **THE FALLBACK IS THE SHARED FACE** (`shared/lib/agent-name.ts › agentFaceName`), not a
 * local `|| "New Agent"`: three readers spelling one string is what produced this in the first
 * place.
 */
export function mapAgents(
  rows: RunningSessionRow[],
  names: Map<string, string>,
  viewerId: string
): HomeAgentRow[] {
  return rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    // The container's own channel name is authoritative; the denormalised
    // `channel_name` on the session can lag a rename.
    channelName: names.get(row.workspace_id) ?? row.channel_name ?? "",
    name: agentFaceName(row.display_name),
    state: row.state,
    detail: narrowDetail(row.detail),
    // ⚠ THE ID AND THE TITLE ARE TWO DIFFERENT ANSWERS AND BOTH RIDE. The title
    // is what the row PRINTS; the id is where clicking it LANDS, and a session
    // launched at channel level has neither.
    threadId: row.task_id,
    threadTitle: row.thread_title,
    mine: row.user_id === viewerId,
    updatedAt: row.updated_at,
  }));
}
