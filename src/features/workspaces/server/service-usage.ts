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
  type WorkspaceSessionRow,
} from "./repository-usage";
import { sumWorkspaceCreditBins } from "./repository-usage-tally";
import {
  filterSeatBurns,
  isWorkspaceSeatBurn,
  readCreditRails,
  readMessageRail,
  readToolRail,
  toolKey,
} from "./usage-rails";
import type { WorkspaceToolTallyRow } from "./repository-usage-tally";

/** 🔒 **RE-EXPORTED, NOT RE-DEFINED.** The predicate moved to `usage-rails.ts`
 *  with the folds that apply it; every caller and `service-usage.test.ts` still
 *  import it from here, and a second spelling of a wallet fence is how the rails
 *  and the plot start disagreeing. */
export { isWorkspaceSeatBurn };

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
  /** Credits per channel — Postgres' `GROUP BY`, or the fold over a capped scan.
   *  ⚠ A CHANNEL ABSENT FROM THE MAP IS A ZERO ROW, NEVER A MISSING ONE. */
  credits: ReadonlyMap<string, number>,
  /** Messages per channel, same two sources. */
  messages: ReadonlyMap<string, number>
): WorkspaceChannelUsage[] {
  const rows = new Map<string, WorkspaceChannelUsage>();
  for (const ref of visible) {
    rows.set(ref.id, {
      channelId: ref.id,
      name: ref.name,
      // ⚠ READ THROUGH THE VISIBLE SET, never by iterating the tallies: a burn in
      // a channel the caller cannot open counts on the series and on no row here.
      credits: credits.get(ref.id) ?? 0,
      messages: messages.get(ref.id) ?? 0,
    });
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
  /** Credits per `user_id` — Postgres' `GROUP BY`, or the fold over a capped
   *  scan. ⚠ A `null` author never reaches this map (see {@link foldSeatBurns}
   *  and the aggregate's own `null` key). */
  credits: ReadonlyMap<string, number>,
  roles: Map<string, Role>,
  names: Map<string, string>
): WorkspacePersonUsage[] {
  const byUser = new Map<string, WorkspacePersonUsage>();
  for (const [userId, amount] of credits) {
    const role = roles.get(userId);
    // 🔒 THE ROSTER IS THE FENCE: no role means not on the members page, which
    // means no NAME and no row here.
    if (role === undefined) continue;
    byUser.set(userId, {
      userId,
      name: names.get(userId) ?? "",
      role,
      credits: amount,
    });
  }
  return [...byUser.values()]
    .sort((a, b) => b.credits - a.credits || a.userId.localeCompare(b.userId))
    .slice(0, PERSON_ROWS);
}

/** The busiest `(tool, op)` pairs. ⚠ TIES BREAK ON THE KEY, so the list is
 *  TOTALLY ordered and does not shuffle between two loads of the same numbers. */
export function tallyWorkspaceTools(
  /** `(tool, op)` pairs with their call counts — Postgres' `GROUP BY`, or the
   *  fold over a capped scan. ⚠ COUNTS, not rows: the aggregate answers one row
   *  per pair and a per-row shape here would have to re-expand them. */
  rows: readonly WorkspaceToolTallyRow[]
): WorkspaceToolUsage[] {
  const byPair = new Map<string, WorkspaceToolUsage>();
  for (const row of rows) {
    const key = toolKey(row.tool, row.op);
    const found = byPair.get(key);
    if (found) found.calls += row.calls;
    else byPair.set(key, { tool: row.tool, op: row.op, calls: row.calls });
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
      threadId: row.thread_id,
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
 * 🔒 **SUMMED BY POSTGRES SINCE SAMUEL #2935, AND THE HAUL IT REPLACED WAS A
 * WRONG ANSWER, NOT A SLOW ONE.** The superseded note here read "PostgREST
 * cannot aggregate a SUM, so this is the sanctioned haul-and-tally" — true of
 * PostgREST, and the reason this asked for 10,000 raw rows newest-first and
 * binned them in memory. `max_rows` then handed back 1,000 of them, silently, so
 * a container whose newest days exceed the cap drew a month whose older bars were
 * zeroes nobody measured. `workspace_credit_usage_bins` returns ≤31 rows.
 *
 * ⚠ **THE WINDOW IS BOUNDED AT BOTH ENDS EITHER WAY** — unbounded, a PAST window
 * returns the current period's rows and plots the asked-for one as zeroes.
 * ⚠ **ZERO-FILLED FROM THE WINDOW ARRAY, NEVER FROM THE RESULT SET**: the
 * aggregate answers only bins that HAVE spend, and the axis is the frame.
 */
export async function readWorkspaceCreditBins(
  workspaceId: string,
  windows: OverviewWindow[],
  /** Narrow every bin to ONE channel. ⚠ THE CALLER MUST HAVE PROVED VISIBILITY
   *  FIRST — the route does it against `listVisibleChannelRefs`. */
  channelId: string | null = null,
  /** What one bin spans, from the shared calendar
   *  (`overview-series/windows.ts › overviewBucketFor`). ⚠ It must MATCH the
   *  windows passed above: Postgres groups by this, and a `day` grouping read
   *  against hour bins lands every row on one bar. Day for every workspace range
   *  (`types.ts › WorkspaceSeriesRange` has no `24h`). */
  bucket: "hour" | "day" = "day"
): Promise<{ counts: number[]; truncated: boolean }> {
  // ⚠ NO WINDOWS, NO READ. An unreachable case today (every range has bins),
  // but the alternative spelling is an empty `since` — an UNBOUNDED scan of the
  // whole ledger to fill an array of length zero.
  if (windows.length === 0) return { counts: [], truncated: false };
  const span = {
    startIso: windows[0].startIso,
    endIso: windows[windows.length - 1].endIso,
  };
  const channelIds = await listWorkspaceChannelIds(workspaceId);
  const bins = await sumWorkspaceCreditBins(
    workspaceId,
    channelIds,
    span,
    bucket,
    channelId
  );
  if (bins) {
    return {
      counts: windows.map((win) => bins.get(win.startIso) ?? 0),
      // ⚠ FALSE AS A MEASUREMENT: one row per bin cannot reach the ceiling.
      truncated: false,
    };
  }
  // ⚠ **THE DEGRADE, AND IT IS A FLOOR THAT SAYS SO.** The migration ships
  // written-not-applied, so until it lands this is the live path: the old capped
  // haul, binned in memory, reporting `truncated` through the now-honest
  // `clippedAt`. Numbers can under-report on a busy month; the plot is never
  // blank and the clip banner fires, which is the whole difference from the bug.
  const scan = filterSeatBurns(
    await scanWorkspaceCreditEvents(workspaceId, channelIds, span.startIso, {
      untilIso: span.endIso,
      channelId,
    }),
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
 * ⚠ FOUR STATEMENTS PLUS TWO LOOKUPS, NEVER A QUERY PER CHANNEL (§9) — and the
 * three breakdown statements are GROUP BYs now rather than hauls (#2935). Each
 * falls back to its old capped scan when the aggregate is not applied yet, which
 * is a second statement on that arm and nothing more.
 */
export async function getWorkspaceUsage(
  workspaceId: string,
  visible: readonly VisibleChannelRef[],
  now: Date = new Date()
): Promise<WorkspaceUsageBreakdown> {
  const since = overviewSince("month", now);
  const channelIds = await listWorkspaceChannelIds(workspaceId);
  const [credits, tools, messages, roles] = await Promise.all([
    readCreditRails(workspaceId, channelIds, since),
    readToolRail(workspaceId, since),
    readMessageRail(workspaceId, since),
    listWorkspaceRoles(workspaceId),
  ]);
  const names = await resolvePeopleNames(credits.people, roles);
  return {
    since,
    channels: tallyWorkspaceChannels(visible, credits.channels, messages.byChannel),
    people: tallyWorkspacePeople(credits.people, roles, names),
    tools: tallyWorkspaceTools(tools.rows),
    // ⚠ THE DENOMINATOR IS THE LARGEST OF THE THREE, because the breakdowns are
    // read off one of them. Exact where the aggregate answered; the surviving
    // row count where its arm degraded.
    scanned: Math.max(credits.events, tools.calls, messages.messages),
    truncated: credits.truncated || tools.truncated || messages.truncated,
  };
}

/** Names for the by-person rail — ONE `.in()` over the de-duplicated ids (§9),
 *  and 🔒 **only for ids the roster carries**, so a departed member's profile is
 *  never fetched, let alone rendered. */
async function resolvePeopleNames(
  credits: ReadonlyMap<string, number>,
  roles: Map<string, Role>
): Promise<Map<string, string>> {
  const ids = [...credits.keys()].filter((id) => roles.has(id));
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
