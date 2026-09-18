import "server-only";
import { agentFaceName } from "@/shared/lib/agent-name";
import {
  binByWindow,
  overviewSince,
  overviewWindows,
  type OverviewWindow,
} from "@/features/overview-series/windows";
import type {
  OverviewAgentRow,
  Role,
  WorkspaceChannelUsage,
  WorkspacePersonUsage,
  WorkspaceToolUsage,
  WorkspaceTokenSpend,
  WorkspaceUsageBreakdown,
} from "../types";
import { listProfileSummaries } from "./repository";
import type { VisibleChannelRef } from "./repository-overview";
import {
  listWorkspaceChannelIds,
  listWorkspaceRoles,
  listWorkspaceRunningSessions,
  listWorkspaceTokenSpend,
  scanWorkspaceCreditEvents,
  scanWorkspaceMcpCalls,
  scanWorkspaceMessageChannels,
  type UsageScan,
  type WorkspaceCreditEventRow,
  type WorkspaceSessionRow,
  type WorkspaceToolCallRow,
} from "./repository-usage";

/**
 * THE WORKSPACE OVERVIEW'S USAGE HALF — the credit series, the three rails, the
 * live agent board and this container's token spend (wave 8, R-29(b)).
 *
 * 🔒 **THE SEAT WALLET IS THE WHOLE FENCE, AND IT IS NEVER SUMMED WITH A
 * PERSONAL ONE.** `docs/specs/credit-model-v2.md` §3: a `standard` container's
 * burns land on the CALLER's `seat`; a `link`/`personal` container's land on an
 * owner's `personal`. Those are two meters, and adding them was the exact
 * 2026-09-12 defect (416 on one card beside 0 on another). /home reads the
 * personal wallet and this file reads the seats — **one payload for both kinds
 * was explicitly refused** (R-29: *"not (c) for the payload"*).
 *
 * ⚠ **THE WINDOW ARITHMETIC IS NOT HERE.** Bins, buckets and zero-fill are
 * `features/overview-series/windows.ts`, the one calendar both Overviews draw
 * against (P33). Nothing in this file may grow a second one.
 */

/** Rails' row budgets. ⚠ Ceilings on the RENDER, not on the tally — the scan
 *  denominator travels beside the shares (`scanned`). */
const CHANNEL_ROWS = 8;
const PERSON_ROWS = 8;
const TOOL_ROWS = 8;

/** How many live agent sessions the board carries. ⚠ Above the 15-per-workspace
 *  agent cap, so a full container still renders whole. */
const AGENT_ROWS = 24;

/** 31×24h ending now — deliberately WIDER than the 31 LOCAL days the strip
 *  draws, so the oldest column is never short at any hour but local midnight. */
const TOKEN_SPEND_WINDOW_DAYS = 31;

/**
 * The six CLOSED situation keys `channel_sessions.detail` may carry.
 *
 * ⚠ **A THIRD STATEMENT OF ONE CLOSED VOCABULARY, AND THAT IS THE SANCTIONED
 * SHAPE** — `channels/server/collab-dto.ts › narrowSessionDetail` and
 * `home/server/overview-tally.ts › narrowDetail` are the other two, and neither
 * may be imported here (§2: a feature does not reach into another's `server/`).
 * The column's own migration explains why the DB deliberately does NOT `CHECK`
 * this list: a newer desktop shipping a seventh key must be able to STORE it
 * rather than 400 its whole push, so the closed-value test belongs on the READ
 * side. ⚠ `detail` is the ONE peer-visible telemetry column and it is
 * peer-visible ONLY because this vocabulary is closed.
 */
const SESSION_DETAILS: readonly string[] = [
  "thinking",
  "tool",
  "posting",
  "permission",
  "awaiting_peer",
  "awaiting_inbound",
];

function narrowDetail(raw: string | null): string | null {
  return raw !== null && SESSION_DETAILS.includes(raw) ? raw : null;
}

/**
 * IS THIS LEDGER ROW ONE OF **THIS WORKSPACE'S SEAT WALLETS** PAID FOR?
 *
 * 🔒 **THE DEFINITION OF EVERY CREDIT FIGURE ON THIS PAGE, IN ONE PLACE** — the
 * twin of `home/server/overview-tally.ts › isPersonalWalletBurn`, and the two
 * are deliberately disjoint: a row cannot satisfy both, because `wallet` cannot
 * be `personal` and `seat` at once. That disjointness is what makes it safe for
 * the two Overviews to exist side by side.
 *
 * ⚠ **FILTERED TWICE ON PURPOSE.** `repository-usage.ts ›
 * scanWorkspaceCreditEvents` pushes the same predicate into PostgREST so the
 * rows never leave the database; this is the DEFINITION the suite pins, and it
 * fails CLOSED if the pushdown is ever loosened. It must never be relaxed to
 * "trust the query".
 *
 * ⚠ **`wallet` IS NOT NARROWED TO A UNION** — the column has no `CHECK`-closed
 * future, so an unknown wallet is not this workspace's, which fails closed
 * (the argument {@link narrowDetail} makes from the other side).
 */
export function isWorkspaceSeatBurn(
  row: WorkspaceCreditEventRow,
  workspaceId: string,
  channelIds: ReadonlySet<string>
): boolean {
  if (row.wallet !== "seat" && row.wallet !== "workspace") return false;
  if (row.origin_workspace_id === workspaceId) return true;
  return row.channel_id !== null && channelIds.has(row.channel_id);
}

/** The second half of "filtered twice on purpose", applied once however the
 *  rows were fetched. */
function filterSeatBurns(
  scan: UsageScan<WorkspaceCreditEventRow>,
  workspaceId: string,
  channelIds: ReadonlySet<string>
): UsageScan<WorkspaceCreditEventRow> {
  return {
    rows: scan.rows.filter((row) =>
      isWorkspaceSeatBurn(row, workspaceId, channelIds)
    ),
    truncated: scan.truncated,
  };
}

/* ------------------------------ the tallies ----------------------------- */

/**
 * CREDITS and MESSAGES per channel, descending by credits.
 *
 * 🔒 **ONE ROW PER *VISIBLE* CHANNEL, AND THE FENCE IS WHY.** This rail prints a
 * channel NAME, which is content — `service-overview.ts` states the page's two
 * postures, and content is viewer-filtered server-side. A burn in a channel the
 * caller cannot open contributes to the series (an integer) and to nothing here.
 * ⚠ **SO THIS RAIL DOES NOT SUM TO THE PLOT ABOVE IT, BY CONSTRUCTION** — the
 * same shape /home's by-channel rail has, where a "Desktop agent" burn has no
 * channel to sit under. Two questions, not two answers to one.
 *
 * ⚠ EVERY VISIBLE CHANNEL GETS A ROW, including the silent ones: the comparison
 * is "which of my rooms is busy", and dropping the quiet ones turns an answer of
 * "none of them" into an empty list that reads as a failed read.
 */
export function tallyWorkspaceChannels(
  visible: readonly VisibleChannelRef[],
  credits: readonly WorkspaceCreditEventRow[],
  messages: readonly { channel_id: string }[]
): WorkspaceChannelUsage[] {
  const rows = new Map<string, WorkspaceChannelUsage>();
  for (const ref of visible) {
    rows.set(ref.id, {
      channelId: ref.id,
      name: ref.name,
      credits: 0,
      messages: 0,
    });
  }
  for (const event of credits) {
    const row = event.channel_id ? rows.get(event.channel_id) : undefined;
    if (row) row.credits += event.amount;
  }
  for (const message of messages) {
    const row = rows.get(message.channel_id);
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
 * CREDITS per PERSON, descending — who burned this workspace's seats.
 *
 * ⚠ **A ROW WITH NO `user_id` IS DROPPED, NOT BUCKETED AS "UNKNOWN".** The
 * column is `ON DELETE SET NULL`, so a null means the account is GONE — there is
 * nobody to attribute the spend to, and an "Unknown" row in a per-person
 * breakdown reads as a person.
 * ⚠ A person who has LEFT keeps their rows with a `null` role: the spend
 * happened, and dropping it would under-count the bill.
 */
export function tallyWorkspacePeople(
  rows: readonly WorkspaceCreditEventRow[],
  roles: Map<string, Role>,
  names: Map<string, string>
): WorkspacePersonUsage[] {
  const byUser = new Map<string, WorkspacePersonUsage>();
  for (const row of rows) {
    if (!row.user_id) continue;
    const found = byUser.get(row.user_id);
    if (found) {
      found.credits += row.amount;
      continue;
    }
    byUser.set(row.user_id, {
      userId: row.user_id,
      name: names.get(row.user_id) ?? "",
      role: roles.get(row.user_id) ?? null,
      credits: row.amount,
    });
  }
  return [...byUser.values()]
    .sort((a, b) => b.credits - a.credits || a.userId.localeCompare(b.userId))
    .slice(0, PERSON_ROWS);
}

/** Tool + op, as one map key. A tool with no op keys on the tool alone rather
 *  than on a trailing separator. */
function toolKey(tool: string, op: string): string {
  return op ? `${tool}:${op}` : tool;
}

/** The busiest `(tool, op)` pairs. ⚠ TIES BREAK ON THE KEY, so the list is
 *  TOTALLY ordered and does not shuffle between two loads of the same numbers. */
export function tallyWorkspaceTools(
  rows: readonly WorkspaceToolCallRow[]
): WorkspaceToolUsage[] {
  const byPair = new Map<string, WorkspaceToolUsage>();
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
 * Session rows → the agent board's shape.
 *
 * 🔒 **CONSTRUCTED, NOT SPREAD.** Naming each field means a column added to
 * `channel_sessions` — including a new OPERATOR-ONLY one — cannot reach this
 * payload by accident; an omit-list would fail OPEN.
 * ⚠ `mine` REPLACES THE `user_id`, and that is the privacy shape: the caller
 * needs to tell their own agents from a peer's and does not need the peer's id
 * to do it (R-29's privacy half, R-25's read-only peer rows).
 * ⚠ A session whose channel the caller cannot see is DROPPED — the card prints
 * a channel name and a thread title, both content.
 */
export function mapWorkspaceAgents(
  rows: readonly WorkspaceSessionRow[],
  channelNames: Map<string, string>,
  viewerId: string
): OverviewAgentRow[] {
  const out: OverviewAgentRow[] = [];
  for (const row of rows) {
    if (!row.channel_id) continue;
    const name = channelNames.get(row.channel_id);
    if (name === undefined) continue;
    out.push({
      id: row.id,
      channelId: row.channel_id,
      // The channel's own name is authoritative; the denormalised
      // `channel_name` on the session can lag a rename.
      channelName: name || row.channel_name || "",
      name: agentFaceName(row.display_name),
      state: row.state,
      detail: narrowDetail(row.detail),
      threadId: row.task_id,
      threadTitle: row.thread_title,
      mine: row.user_id === viewerId,
      updatedAt: row.updated_at,
    });
  }
  return out;
}

/* ------------------------------- the reads ------------------------------ */

/**
 * THE CREDIT SERIES' BINS — one summed figure per window, zero-filled.
 *
 * ⚠ **HAULED ONCE AND BINNED IN MEMORY, unlike the three counted metrics.**
 * PostgREST cannot aggregate a SUM, so this is the sanctioned haul-and-tally
 * (§9) — and it is the only arm of the series that can report `truncated`.
 * ⚠ **THE HAUL IS BOUNDED AT BOTH ENDS.** The scan is newest-first and capped,
 * so an unbounded haul anchored in a PAST window would return the current
 * period's rows and bin the plotted one to zeroes with nothing to report.
 */
export async function readWorkspaceCreditBins(
  workspaceId: string,
  windows: OverviewWindow[],
  /** Narrow every bin to ONE channel. ⚠ THE CALLER MUST HAVE PROVED VISIBILITY
   *  FIRST — the route does it against `listVisibleChannelRefs`. */
  channelId: string | null = null
): Promise<{ counts: number[]; truncated: boolean }> {
  const channelIds = await listWorkspaceChannelIds(workspaceId);
  const scan = filterSeatBurns(
    await scanWorkspaceCreditEvents(
      workspaceId,
      channelIds,
      windows[0]?.startIso ?? "",
      { untilIso: windows[windows.length - 1]?.endIso, channelId }
    ),
    workspaceId,
    new Set(channelIds)
  );
  return {
    counts: binByWindow(
      scan.rows,
      windows,
      (row) => row.created_at,
      (row) => row.amount
    ),
    truncated: scan.truncated,
  };
}

/**
 * THE THREE RAILS, over the CURRENT CALENDAR MONTH.
 *
 * ⚠ **THE WINDOW IS THE CREDIT PERIOD AND NO CONTROL MOVES IT** — the same
 * split /home makes, so the rails and the page's `PeriodStats` figure answer for
 * one window instead of two nearby ones. The range switcher belongs to the plot.
 *
 * ⚠ **FOUR STATEMENTS PLUS TWO LOOKUPS, NEVER A QUERY PER CHANNEL** (§9). Each
 * `.in()` / `.eq()` spans the whole container.
 */
export async function getWorkspaceUsage(
  workspaceId: string,
  visible: readonly VisibleChannelRef[],
  now: Date = new Date()
): Promise<WorkspaceUsageBreakdown> {
  const since = overviewSince("month", now);
  const channelIds = await listWorkspaceChannelIds(workspaceId);
  const [credits, calls, messages, roles] = await Promise.all([
    scanWorkspaceCreditEvents(workspaceId, channelIds, since),
    scanWorkspaceMcpCalls(workspaceId, since),
    scanWorkspaceMessageChannels(workspaceId, since),
    listWorkspaceRoles(workspaceId),
  ]);
  const seat = filterSeatBurns(credits, workspaceId, new Set(channelIds));
  const names = await resolvePeopleNames(seat.rows);
  return {
    since,
    channels: tallyWorkspaceChannels(visible, seat.rows, messages.rows),
    people: tallyWorkspacePeople(seat.rows, roles, names),
    tools: tallyWorkspaceTools(calls.rows),
    // ⚠ THE DENOMINATOR IS THE LARGEST SCAN'S, because the breakdowns that can
    // be clipped are read off one of the three.
    scanned: Math.max(
      credits.rows.length,
      calls.rows.length,
      messages.rows.length
    ),
    truncated: credits.truncated || calls.truncated || messages.truncated,
  };
}

/** Names for the by-person rail — ONE `.in()` over the de-duplicated ids, the
 *  shape §9 requires (never a query per row). */
async function resolvePeopleNames(
  rows: readonly WorkspaceCreditEventRow[]
): Promise<Map<string, string>> {
  const ids = [
    ...new Set(rows.flatMap((row) => (row.user_id ? [row.user_id] : []))),
  ];
  const profiles = await listProfileSummaries(ids);
  const names = new Map<string, string>();
  for (const id of ids) {
    const profile = profiles.get(id);
    // Same precedence the channels transcript and the member-load card use.
    names.set(id, profile?.displayName || profile?.email || "");
  }
  return names;
}

/** EVERYONE'S live agents in this container (R-25), viewer-filtered to the
 *  channels the caller can open. */
export async function getWorkspaceAgentBoard(
  workspaceId: string,
  userId: string,
  visible: readonly VisibleChannelRef[]
): Promise<OverviewAgentRow[]> {
  const sessions = await listWorkspaceRunningSessions(workspaceId, AGENT_ROWS);
  return mapWorkspaceAgents(
    sessions.rows,
    new Map(visible.map((ref) => [ref.id, ref.name])),
    userId
  );
}

/**
 * THIS CONTAINER'S TOKEN SPEND, FOR THE CALLER'S OWN AGENTS ONLY.
 *
 * 🔒 **PER-MEMBER-OWN IS THE WHOLE ANSWER, AND IT IS A FENCE DECISION RATHER
 * THAN A MISSING FEATURE (wave 8; INVARIANTS §9).** `workspace_token_spend` is
 * RLS-deny-all and operator-fenced on purpose. A workspace-wide total does not
 * become safe by being a total: in a two-member container, "everyone" minus "me"
 * IS the colleague's spend, so the aggregate is the fence removed by
 * subtraction. R-29 left the operator fence standing, so the honest maximum is
 * the caller's own rows, and the panel says whose they are.
 *
 * ⚠ **IT ANSWERS RUNS, NOT DAYS.** The strip buckets by the operator's LOCAL
 * day and this server cannot know that zone, so each run travels as its own
 * instant and the renderer names the days.
 */
export async function getWorkspaceTokenSpend(
  workspaceId: string,
  userId: string,
  now: Date = new Date()
): Promise<WorkspaceTokenSpend> {
  const since = new Date(
    now.getTime() - TOKEN_SPEND_WINDOW_DAYS * 86_400_000
  ).toISOString();
  const scan = await listWorkspaceTokenSpend(workspaceId, userId, since);
  return {
    marks: scan.rows.map((row) => ({ at: row.started_at, tokens: row.tokens })),
    truncated: scan.truncated,
  };
}

/** Re-exported so `service-overview.ts` can build a series without importing
 *  the shared calendar twice. */
export { overviewWindows };
