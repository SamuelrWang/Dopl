import "server-only";
import { agentFaceName } from "@/shared/lib/agent-name";
import { narrowSessionDetail } from "@/features/overview-series/session-detail";
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
 * 🔒 **THE SEAT WALLET IS THE WHOLE FENCE AND IS NEVER SUMMED WITH A PERSONAL
 * ONE** — INVARIANTS §9 states it once for both Overviews. The window
 * arithmetic is `features/overview-series/windows.ts`; nothing here may grow a
 * second calendar.
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
 * IS THIS LEDGER ROW ONE OF **THIS WORKSPACE'S SEAT WALLETS** PAID FOR?
 *
 * 🔒 The definition behind every credit figure on this page, and the disjoint
 * twin of `home/server/overview-tally.ts › isPersonalWalletBurn` — a row cannot
 * satisfy both, because `wallet` cannot be `personal` and `seat` at once.
 *
 * ⚠ **FILTERED TWICE ON PURPOSE.** `repository-usage.ts ›
 * scanWorkspaceCreditEvents` pushes the same predicate into PostgREST; this is
 * the DEFINITION, and it fails closed if the pushdown is ever loosened.
 * ⚠ `wallet` is NOT narrowed to a union — the column has no `CHECK`, so an
 * unknown wallet is not this workspace's, which fails closed.
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
 * 🔒 **ONE ROW PER *VISIBLE* CHANNEL.** This rail prints a channel NAME, which
 * is content, and content is viewer-filtered server-side (INVARIANTS §9). A
 * burn in a channel the caller cannot open contributes to the series — an
 * integer — and to nothing here, **so this rail does not sum to the plot above
 * it, by construction.**
 *
 * ⚠ EVERY VISIBLE CHANNEL GETS A ROW, including the silent ones: dropping the
 * quiet ones turns an answer of "none of them" into an empty list that reads as
 * a failed read.
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
 * 🔒 **ONE ROW PER PERSON THE MEMBERS CONSOLE WOULD SHOW THIS CALLER, AND
 * NOTHING ELSE.** This rail prints a NAME, so it is fenced exactly as
 * `docs/MEMBERS-AUTHORIZATION.md` fences the roster: the roster is
 * `status='active'` (`repository.ts › listMembers`), so a person who has LEFT
 * is absent there and is absent here. Their spend still counts on the series
 * above — the plot is integers — but a departed colleague's NAME and figure are
 * not this page's to print, and "who used to be here" is not a question the
 * members page answers.
 * ⚠ **A ROW WITH NO `user_id` IS DROPPED, NOT BUCKETED AS "UNKNOWN".** The
 * column is `ON DELETE SET NULL`, so a null means the account is gone, and an
 * "Unknown" row in a per-person breakdown reads as a person.
 */
export function tallyWorkspacePeople(
  rows: readonly WorkspaceCreditEventRow[],
  roles: Map<string, Role>,
  names: Map<string, string>
): WorkspacePersonUsage[] {
  const byUser = new Map<string, WorkspacePersonUsage>();
  for (const row of rows) {
    if (!row.user_id) continue;
    const role = roles.get(row.user_id);
    if (role === undefined) continue;
    const found = byUser.get(row.user_id);
    if (found) {
      found.credits += row.amount;
      continue;
    }
    byUser.set(row.user_id, {
      userId: row.user_id,
      name: names.get(row.user_id) ?? "",
      role,
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
 * 🔒 **CONSTRUCTED, NOT SPREAD** — naming each field means a column added to
 * `channel_sessions`, including a new OPERATOR-ONLY one, cannot reach this
 * payload by accident; an omit-list would fail OPEN.
 * ⚠ `mine` REPLACES THE `user_id`: the caller tells their own agents from a
 * peer's without being handed the peer's id (R-29's privacy half).
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
      detail: narrowSessionDetail(row.detail),
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
 * ⚠ **HAULED ONCE AND BINNED IN MEMORY**, unlike the three counted metrics:
 * PostgREST cannot aggregate a SUM, so this is the sanctioned haul-and-tally
 * (§9), and the only arm of the series that can report `truncated`.
 * ⚠ **THE HAUL IS BOUNDED AT BOTH ENDS** — an unbounded haul anchored in a PAST
 * window would return the current period's rows and bin the plotted one to
 * zeroes with nothing to report.
 */
export async function readWorkspaceCreditBins(
  workspaceId: string,
  windows: OverviewWindow[],
  /** Narrow every bin to ONE channel. ⚠ THE CALLER MUST HAVE PROVED VISIBILITY
   *  FIRST — the route does it against `listVisibleChannelRefs`. */
  channelId: string | null = null
): Promise<{ counts: number[]; truncated: boolean }> {
  // ⚠ NO WINDOWS, NO READ. An unreachable case today (every range has bins),
  // but the alternative spelling is an empty `since` — an UNBOUNDED scan of the
  // whole ledger to fill an array of length zero.
  if (windows.length === 0) return { counts: [], truncated: false };
  const channelIds = await listWorkspaceChannelIds(workspaceId);
  const scan = filterSeatBurns(
    await scanWorkspaceCreditEvents(
      workspaceId,
      channelIds,
      windows[0].startIso,
      { untilIso: windows[windows.length - 1].endIso, channelId }
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
 * split /home makes, so the rails and the page's `PeriodStats` figure answer
 * for one window. The range switcher belongs to the plot.
 * ⚠ FOUR STATEMENTS PLUS TWO LOOKUPS, NEVER A QUERY PER CHANNEL (§9).
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
  const names = await resolvePeopleNames(seat.rows, roles);
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

/** Names for the by-person rail — ONE `.in()` over the de-duplicated ids (§9),
 *  and 🔒 **only for ids the roster carries**, so a departed member's profile is
 *  never fetched, let alone rendered. */
async function resolvePeopleNames(
  rows: readonly WorkspaceCreditEventRow[],
  roles: Map<string, Role>
): Promise<Map<string, string>> {
  const ids = [
    ...new Set(
      rows.flatMap((row) =>
        row.user_id && roles.has(row.user_id) ? [row.user_id] : []
      )
    ),
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
 * 🔒 **PER-MEMBER-OWN IS THE WHOLE ANSWER AND IT IS A FENCE DECISION RATHER
 * THAN A MISSING FEATURE** — stated once in INVARIANTS §9: an aggregate over a
 * two-member container is the operator fence removed by subtraction, so there
 * is no workspace-wide variant and there must not be one.
 *
 * ⚠ **IT ANSWERS RUNS, NOT DAYS.** The strip buckets by the operator's LOCAL
 * day and this server cannot know that zone.
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
