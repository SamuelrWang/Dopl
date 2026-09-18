import "server-only";
import { HttpError } from "@/shared/lib/http-error";
import { listProfileSummaries } from "@/features/workspaces/server/repository";
import type { Role } from "@/features/workspaces/types";
import {
  HOME_OVERVIEW_METRICS,
  HOME_OVERVIEW_RANGES,
  type HomeOverview,
  type HomeOverviewBucket,
  type HomeOverviewMetric,
  type HomeOverviewRange,
  type HomeOverviewSeries,
  type HomePersonUsage,
  type HomeSeriesPoint,
} from "../overview-types";
import {
  countMetricInWindow,
  listContainerRoles,
  listOwnedPersonalContainerIds,
  listRunningSessions,
  scanCreditEvents,
  scanMcpCalls,
  scanMessageChannels,
  type CreditEventScanRow,
  type HomeWindow,
  type Scan,
} from "./repository-overview";
import {
  binCredits,
  isPersonalWalletBurn,
  mapAgents,
  tallyChannels,
  tallyCreditPeople,
  tallyTools,
} from "./overview-tally";
import { resolveUsageChannel } from "./overview-series-params";
import * as repo from "./repository";
/**
 * Containers the OVERVIEW tallies over. ⚠ **DECLARED HERE SINCE WAVE 3** — it was
 * `service-reads.ts › HOME_CHANNEL_LIMIT`, the ceiling on the deleted home channel
 * LIST, and two reads sharing a number they do not share a reason for is how one of
 * them silently inherits the other's page size. A NON-REPORTING ceiling, on §9's
 * sanctioned terms for this surface.
 */
const HOME_CONTAINER_TALLY_LIMIT = 200;

/**
 * Everything behind the /home Overview face (2026-09-01).
 *
 * ⚠ **THE FENCE IS THE USER, EXACTLY AS `getHomeChannels`' IS** (INVARIANTS
 * §9's home bullet). Nothing here is workspace-scoped and nothing here resolves
 * a membership: every read enters through
 * `repository-containers.ts › listLinkContainers`, i.e.
 * `workspace_members.user_id = caller AND status = 'active' AND
 * workspaces.kind = 'link'`, and the resulting id list is handed to the
 * repository AS ITS ENTIRE FENCE. The repository runs service-role and bypasses
 * RLS, so **no id a caller sent may ever reach it**.
 *
 * 🔒 **EXCEPT THE CREDIT READ, WHOSE FENCE IS THE READER'S WALLET (2026-09-12).**
 * A wallet belongs to a PERSON, so the credit rows are selected by
 * `payer_user_id` and by the containers the reader OWNS — see
 * {@link scanPersonalWalletBurns}, which carries the measurement. Membership and
 * ownership are different lists and this face now uses both, each for the
 * question it answers. Still no caller-supplied id on either path.
 *
 * 🔒 **THE FACE IS CROSS-CHANNEL AND THE `?workspaceId=` NARROWING IS GONE
 * (Samuel, 2026-09-01) — THIS IS THE DUPLICATION FIX.** The page used to stack
 * an account-wide panel over a channel-scoped one built from the SAME
 * components, so an operator whose fence held one container saw every stat tile,
 * chart and rail rendered TWICE from two payloads that were identical by
 * construction. Removing the second scope removes the class of bug, not just
 * this instance: there is no longer a second panel that CAN agree or disagree.
 * ⚠ Do not reintroduce a scoped variant of this payload — the left list scopes
 * the CHANNELS face, and the Overview face is about the account.
 *
 * ⚠ **TWO ROUND TRIPS, AND THE SPLIT IS §9'S RULE APPLIED.** `getHomeOverview`
 * is the whole face minus the histogram; the histogram is
 * `getHomeOverviewSeries` because its `metric` is a query PARAMETER the user
 * switches. The credit ALLOWANCE is neither: the page reuses
 * `GET /api/billing/status`, which is also the only place the container→wallet
 * routing is resolved (`billing/server/credits-service.ts ›
 * resolveBillingTarget`). ⚠ That used to be a container→WORKSPACE reroute; since
 * 2026-09-07 a home burn spends the owner's PERSONAL WALLET, so the allowance
 * this page shows is a person's, not a workspace's.
 */

/** Bars in a `24h` series — one per hour, ending on the current hour. */
const HOURS_IN_DAY = 24;

/** How many live agent sessions the board carries, across all channels. */
const AGENT_ROWS = 24;

/** Bins, and the width of one, for each window. */
const RANGE_SHAPE: Record<
  HomeOverviewRange,
  { bins: number; bucket: HomeOverviewBucket }
> = {
  "24h": { bins: HOURS_IN_DAY, bucket: "hour" },
  "7d": { bins: 7, bucket: "day" },
  "30d": { bins: 30, bucket: "day" },
  // ⚠ `bins` IS COMPUTED, not stored — a month is 28..31 days and the window is
  // month-to-DATE. `rangeWindows` overrides this number; it is here so the
  // record stays total over the union.
  month: { bins: 31, bucket: "day" },
};

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * `range` off the query string, or a 400.
 *
 * ⚠ NEVER A SILENT FALL-THROUGH TO A DEFAULT WINDOW (§9): a page that answers
 * for the last 30 days under a "24h" heading is worse than an error.
 */
export function parseRange(raw: string | null): HomeOverviewRange {
  const found = HOME_OVERVIEW_RANGES.find((candidate) => candidate === raw);
  if (!found) {
    throw new HttpError(
      400,
      "INVALID_RANGE",
      `range must be one of: ${HOME_OVERVIEW_RANGES.join(", ")}`
    );
  }
  return found;
}

/** `metric` off the query string, or a 400. Same rule as {@link parseRange}. */
export function parseMetric(raw: string | null): HomeOverviewMetric {
  const found = HOME_OVERVIEW_METRICS.find((candidate) => candidate === raw);
  if (!found) {
    throw new HttpError(
      400,
      "INVALID_METRIC",
      `metric must be one of: ${HOME_OVERVIEW_METRICS.join(", ")}`
    );
  }
  return found;
}

/** Truncate `at` down to the start of its UTC hour. */
function hourStart(at: Date): Date {
  return new Date(Math.floor(at.getTime() / HOUR_MS) * HOUR_MS);
}

/** Truncate `at` down to the start of its UTC day. */
function dayStart(at: Date): Date {
  return new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate())
  );
}

/**
 * The bins for one range, oldest first.
 *
 * ⚠ THE LAST BIN OF A ROLLING RANGE IS PARTIAL AND THAT IS CORRECT — it is "so
 * far today" (or "this hour"). What would NOT be correct is extending a ROLLING
 * window into the future so the bar looks finished.
 *
 * 🔒 **`month` IS THE WHOLE CALENDAR MONTH — EVERY DAY OF IT, 28..31 BINS — AND
 * IT IS THE ONE RANGE THAT DOES REACH INTO THE FUTURE (Samuel, 2026-09-01:
 * "show the month").** It was MONTH-TO-DATE for one pass, `bins =
 * now.getUTCDate()`, which is **1 on the first of the month** — so the chart
 * rendered a SINGLE bar stretched across the whole plot with `1/9` under it.
 * That is the defect this rewrite exists to fix, and month-to-date reproduces it
 * every month on the 1st.
 * ⚠ **THE FUTURE BINS ARE ZERO AND THAT IS THE POINT**: the axis is the FRAME
 * the operator reads the month against, and a month that grows a bar a day is
 * the picture they asked for. A future day's zero is not a claim that nothing
 * happened — it is a day that has not happened, which the axis position already
 * says.
 */
export function rangeWindows(
  range: HomeOverviewRange,
  now: Date = new Date()
): HomeWindow[] {
  const { bucket } = RANGE_SHAPE[range];
  const width = bucket === "hour" ? HOUR_MS : DAY_MS;

  if (range === "month") {
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();
    // Day 0 of the NEXT month is the last day of this one — 28/29/30/31 without
    // a leap-year table.
    const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const first = Date.UTC(year, month, 1);
    return Array.from({ length: days }, (_, index) => ({
      startIso: new Date(first + index * width).toISOString(),
      endIso: new Date(first + (index + 1) * width).toISOString(),
    }));
  }

  const last = bucket === "hour" ? hourStart(now) : dayStart(now);
  const bins = RANGE_SHAPE[range].bins;
  const windows: HomeWindow[] = [];
  for (let i = bins - 1; i >= 0; i--) {
    const start = new Date(last.getTime() - i * width);
    windows.push({
      startIso: start.toISOString(),
      endIso: new Date(start.getTime() + width).toISOString(),
    });
  }
  return windows;
}

/** Where a range's window opens — the first bin's start, so the totals and the
 *  bars describe the SAME window rather than two nearby ones. */
export function rangeSince(
  range: HomeOverviewRange,
  now: Date = new Date()
): string {
  const windows = rangeWindows(range, now);
  return windows[0]?.startIso ?? now.toISOString();
}

export function bucketFor(range: HomeOverviewRange): HomeOverviewBucket {
  return RANGE_SHAPE[range].bucket;
}

/* ----------------------------- the reads ------------------------------- */

/**
 * The fence, plus the display name of every channel in it — and, since rule B,
 * the `channelId → containerId` map the credit rail keys by.
 *
 * ⚠ **THE MAP COSTS NO ROUND TRIP**: it is the read this function already makes,
 * inverted. The credit ledger files a CHANNEL id (`overview-tally.ts ›
 * tallyChannels`) while every home surface addresses a row by its CONTAINER, so
 * one of the two has to be translated and this is where both are in hand.
 */
async function resolveScope(userId: string): Promise<{
  ids: string[];
  names: Map<string, string>;
  channelContainers: Map<string, string>;
}> {
  const containers = await repo.listLinkContainers(userId, HOME_CONTAINER_TALLY_LIMIT);
  const ids = containers.map((container) => container.id);
  // ⚠ THE NAME COMES FROM THE CHANNEL, NOT THE CONTAINER. A container's `slug`
  // is plumbing; `channels.name` is what every home surface titles a row by.
  const channels = await repo.listContainerChannels(ids);
  const names = new Map<string, string>();
  const channelContainers = new Map<string, string>();
  for (const id of ids) {
    const channel = channels.get(id);
    names.set(id, channel?.name ?? "");
    if (channel) channelContainers.set(channel.id, id);
  }
  return { ids, names, channelContainers };
}

/**
 * The window's burns **THE READER'S OWN PERSONAL WALLET PAID FOR** — the ONE
 * credit read behind the histogram, the by-person rail and the by-channel rail.
 *
 * 🔒 **THIS IS THE FIX FOR THE TWO-COUNTER CARD (Samuel, 2026-09-12: "is the
 * credits usage wired in? I want to make sure").** The credit reads were fenced
 * on the MEMBERSHIP scope above — every home channel the reader had joined — so
 * they summed a quantity no wallet holds: 416 credits in a link container (the
 * reader's personal wallet) PLUS 56 in a standard workspace (a seat wallet),
 * under a heading whose denominator was the personal allowance, beside a
 * Settings pane reading the wallet itself. **Both surfaces answer "what came out
 * of MY personal wallet" now**, and the plot under the bar therefore totals the
 * bar again.
 *
 * ⚠ **THE FENCE IS OWNERSHIP, WHICH IS A SECOND ROUND TRIP AND WORTH IT.**
 * `listOwnedPersonalContainerIds` is `workspaces.owner_id = reader`, NOT the
 * membership list `resolveScope` builds: a burn in somebody else's channel
 * spends THEIR wallet, and a burn in the reader's own `kind='personal'`
 * container spends the reader's without ever appearing in a link-container list.
 * Neither list is a subset of the other, so neither can be derived from the
 * other.
 *
 * ⚠ **FILTERED TWICE ON PURPOSE** — see `overview-tally.ts ›
 * isPersonalWalletBurn`. The repository pushes the same two arms into PostgREST
 * so the rows never leave the database; the predicate here is the DEFINITION the
 * suite pins, and it fails closed if the pushdown is ever loosened.
 * ⚠ `truncated` is the SCAN's, not the filtered list's: a clipped haul is a floor
 * however many of its rows survived the predicate.
 */
async function scanPersonalWalletBurns(
  userId: string,
  sinceIso: string
): Promise<Scan<CreditEventScanRow>> {
  const ownedIds = await listOwnedPersonalContainerIds(userId);
  return filterWalletBurns(
    userId,
    ownedIds,
    await scanCreditEvents(userId, ownedIds, sinceIso)
  );
}

/** The second half of "filtered twice on purpose" — shared by the rails' scan
 *  above and the histogram's narrowed one below, so the DEFINITION is applied
 *  once however the rows were fetched. */
function filterWalletBurns(
  userId: string,
  ownedIds: readonly string[],
  scan: Scan<CreditEventScanRow>
): Scan<CreditEventScanRow> {
  const owned = new Set(ownedIds);
  return {
    rows: scan.rows.filter((row) => isPersonalWalletBurn(row, userId, owned)),
    truncated: scan.truncated,
  };
}

/**
 * The histogram's OWN credit read — the wallet fence above, plus the two
 * narrowings the Usage card's controls send (2026-09-13).
 *
 * ⚠ **IT SHARES THE FENCE AND NOT THE FUNCTION**, because it narrows: the scope
 * becomes a `channel_id` filter on the same statement
 * (`overview-series-params.ts › resolveUsageChannel`).
 * ⚠ **ONE ROUND TRIP MORE THAN THE SCAN ITSELF — the owned-container list, which
 * only the LEGACY arm of the wallet predicate needs.** The superseded version read
 * each container's `kind` as well, because the old scope vocabulary resolved
 * "Desktop agent" to the reader's `kind='personal'` shelves; rule B's
 * `channel_id IS NULL` answers that with no column and no guess.
 * ⚠ **THE HAUL IS BOUNDED AT BOTH ENDS** — see `scanCreditEvents`' `untilIso`:
 * the scan is newest-first and capped, so an unbounded haul anchored in a PAST
 * month would return this month's rows and bin the plotted month to zeroes with
 * nothing to report.
 */
async function scanUsageHistogramBurns(
  userId: string,
  scope: string | null,
  windows: HomeWindow[]
): Promise<Scan<CreditEventScanRow>> {
  const ownedIds = await listOwnedPersonalContainerIds(userId);
  const channel = resolveUsageChannel(scope);
  const scan = await scanCreditEvents(
    userId,
    ownedIds,
    windows[0]?.startIso ?? "",
    {
      untilIso: windows[windows.length - 1]?.endIso,
      ...(channel ? { channel } : {}),
    }
  );
  return filterWalletBurns(userId, ownedIds, scan);
}

/**
 * The histogram. Oldest first.
 *
 * ⚠ **TWO SHAPES OF READ BEHIND ONE ENDPOINT, AND THE DIFFERENCE IS REPORTED.**
 * `mcp` and `messages` are COUNTED per bin — at most 31 exact `head:true`
 * statements, no cliff, zero-filled because a zero was measured. `credits` is
 * SUMMED from a ledger PostgREST cannot aggregate, so it hauls the window ONCE
 * and bins in memory, and it says `truncated` when the haul hit its ceiling.
 *
 * ⚠ **EVERY ARM ZERO-FILLS, THE CREDITS ONE INCLUDED — AND THE SUPERSEDED LINE
 * HERE SAID THE OPPOSITE.** It read "an empty credit ledger answers `points: []`,
 * not zeroed bins", on the argument that the ledger only exists from its
 * migration forward. Samuel overruled it the same day (he wants to SEE the
 * month); the branch below carries the trade.
 *
 * ⚠ **`opts` CARRIES THE HISTOGRAM'S TWO CONTROLS AND THE CREDITS ARM IS THE
 * ONLY ONE THAT READS THEM (2026-09-13).** `scope` narrows to one channel's
 * container or to the Desktop agent's; `monthAnchor` moves the calendar-month
 * window. Both are parsed at the route by `overview-series-params.ts`, which is
 * also where a `monthAnchor` beside a ROLLING range is refused — so `now` here
 * is still only "when is it", never a window nobody asked for.
 * ⚠ **NEITHER TOUCHES THE COUNTED ARMS.** `mcp` and `messages` already answer
 * per-channel questions through `resolveScope`, and nothing on the face asks
 * them for a month that is not the current one.
 */
export async function getHomeOverviewSeries(
  userId: string,
  range: HomeOverviewRange,
  metric: HomeOverviewMetric,
  opts: {
    /** A CHANNEL id (`HomeChannel.channelId`), `"desktop"`, or null for the
     *  whole wallet. ⚠ It was a CONTAINER id until rule B (2026-09-13). */
    scope?: string | null;
    /** Any instant inside the month to plot, or null for the current one. */
    monthAnchor?: Date | null;
    now?: Date;
  } = {}
): Promise<HomeOverviewSeries> {
  const now = opts.now ?? new Date();
  const windows = rangeWindows(range, opts.monthAnchor ?? now);
  const bucket = bucketFor(range);

  if (metric === "credits") {
    // ⚠ **NO `resolveScope` ON THIS ARM SINCE 2026-09-12, AND THAT IS THE FENCE
    // CHANGE VISIBLE AS A SAVED ROUND TRIP.** The credit metric is the reader's
    // WALLET, which is keyed on a person; the membership scope it used to be
    // fenced on is neither needed nor correct here (see
    // {@link scanPersonalWalletBurns}). The counted arms below still resolve it,
    // because `mcp` and `messages` really are per-channel questions.
    const scan = await scanUsageHistogramBurns(
      userId,
      opts.scope ?? null,
      windows
    );
    // ⚠ **A SCOPE WITH NO ROWS READS AS A ZERO-FILLED MONTH, NOT AS A REFUSAL,
    // AND SINCE 2026-09-13 THAT NEEDS NO BRANCH.** A channel the reader merely
    // JOINED spends the OWNER's wallet, so the wallet fence simply returns none of
    // its rows; the superseded version short-circuited an "unowned container" to
    // `null` here and zero-filled by hand.
    // 🔒 **ALWAYS ZERO-FILLED, NEVER AN EMPTY ARRAY (Samuel, 2026-09-01: he
    // wants to SEE the month).** This arm answered `[]` on an empty ledger so
    // the card could say "nothing yet" instead of drawing a flat month — an
    // honesty argument that cost him the chart entirely while the ledger is
    // young. The ruling: **the axis is the frame and the page never loses it.**
    // A zero bar on a day the ledger covers really is zero; on a day before the
    // ledger existed it is unmeasured, and the axis cannot tell those apart —
    // which is the trade he took knowingly.
    return {
      range,
      metric,
      bucket,
      points: binCredits(scan.rows, windows),
      truncated: scan.truncated,
    };
  }

  const { ids } = await resolveScope(userId);
  // ⚠ ONE STATEMENT PER BIN — at most 31, and the whole reason the counted
  // series is not a scan. See `repository-overview.ts › countMetricInWindow`.
  const counts = await Promise.all(
    windows.map((win) => countMetricInWindow(ids, win, metric))
  );
  const points: HomeSeriesPoint[] = windows.map((win, index) => ({
    at: win.startIso,
    count: counts[index] ?? 0,
  }));
  return { range, metric, bucket, points, truncated: false };
}

/**
 * The face minus the histogram, in one round trip.
 *
 * ⚠ **A BOUNDED FAN, never a query per channel (§9).** Seven statements for any
 * number of home channels — every `.in()` spans the whole fence — plus the
 * mention lane's second, id-bounded statement.
 */
export async function getHomeOverview(
  userId: string,
  range: HomeOverviewRange,
  now: Date = new Date()
): Promise<HomeOverview> {
  const { ids, names, channelContainers } = await resolveScope(userId);
  const since = rangeSince(range, now);

  const [credits, calls, msgChannels, roles, liveAgents] = await Promise.all([
    scanPersonalWalletBurns(userId, since),
    scanMcpCalls(ids, since),
    scanMessageChannels(ids, since),
    listContainerRoles(ids),
    listRunningSessions(ids, AGENT_ROWS),
  ]);

  const people = await resolvePeople(credits.rows, roles);

  return {
    range,
    since,
    channels: tallyChannels(
      names,
      channelContainers,
      credits.rows,
      msgChannels.rows
    ),
    people,
    tools: tallyTools(calls.rows),
    agents: mapAgents(liveAgents.rows, names, userId),
    // ⚠ THE DENOMINATOR IS THE LARGEST SCAN'S, because the breakdowns that can
    // be clipped are read off one of the three.
    scanned: Math.max(
      credits.rows.length,
      calls.rows.length,
      msgChannels.rows.length
    ),
    truncated: credits.truncated || calls.truncated || msgChannels.truncated,
  };
}

/** Names for the by-person list — ONE `.in()` over the de-duplicated ids, the
 *  shape §9 requires (never a query per row). */
async function resolvePeople(
  rows: CreditEventScanRow[],
  roles: Map<string, Role>
): Promise<HomePersonUsage[]> {
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
  return tallyCreditPeople(rows, roles, names);
}
