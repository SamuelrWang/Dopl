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
  listRecentThreads,
  listRunningSessions,
  scanCreditEvents,
  scanMcpCalls,
  scanMessageChannels,
  type CreditEventScanRow,
  type HomeWindow,
} from "./repository-overview";
import {
  listPendingConsent,
  listPermissionHeldSessions,
  listUnreadMentions,
} from "./repository-attention";
import {
  mapAgents,
  mapAttention,
  mapThreads,
  tallyChannels,
  tallyCreditPeople,
  tallyTools,
} from "./overview-tally";
import * as repo from "./repository";
import { HOME_CHANNEL_LIMIT } from "./service-reads";

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
 * `GET /api/billing/status`, which is also the only place the container→payer
 * reroute is resolved (`billing/server/credits-service.ts ›
 * resolveBillingTarget`).
 */

/** Bars in a `24h` series — one per hour, ending on the current hour. */
export const HOURS_IN_DAY = 24;

/**
 * How far back the **Recent threads** panel looks.
 *
 * ⚠ **A MINUTES WINDOW, NOT THE PAGE'S RANGE (Samuel, 2026-09-01: "threads
 * active within the last X minutes").** The panel answers "what is happening
 * right now", which is a different question from the month the rails describe —
 * tying it to the range would have made it a duplicate of a month-long thread
 * list. 90 minutes is a working session's worth of context: long enough that a
 * coffee break does not empty the panel, short enough that "recent" is not a
 * euphemism for "today".
 */
export const RECENT_THREAD_MINUTES = 90;

/** How many recently-active threads the panel lists. */
const THREAD_ROWS = 8;

/** How many live agent sessions the board carries, across all channels. */
const AGENT_ROWS = 24;

/** How many blocked items the attention panel lists. */
const ATTENTION_ROWS = 8;

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

/** The fence, plus the display name of every channel in it. */
async function resolveScope(
  userId: string
): Promise<{ ids: string[]; names: Map<string, string> }> {
  const containers = await repo.listLinkContainers(userId, HOME_CHANNEL_LIMIT);
  const ids = containers.map((container) => container.id);
  // ⚠ THE NAME COMES FROM THE CHANNEL, NOT THE CONTAINER. A container's `slug`
  // is plumbing; `channels.name` is what every home surface titles a row by.
  const channels = await repo.listContainerChannels(ids);
  const names = new Map<string, string>();
  for (const id of ids) names.set(id, channels.get(id)?.name ?? "");
  return { ids, names };
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
 * ⚠ **AN EMPTY CREDIT LEDGER ANSWERS `points: []`, NOT ZEROED BINS.** The ledger
 * only exists from `20260901120000_credit_usage_events.sql` forward, so a flat
 * month of zeroes would be a measurement nobody took drawn as fact. The empty
 * array is what lets the surface say "nothing yet" instead.
 */
export async function getHomeOverviewSeries(
  userId: string,
  range: HomeOverviewRange,
  metric: HomeOverviewMetric,
  now: Date = new Date()
): Promise<HomeOverviewSeries> {
  const { ids } = await resolveScope(userId);
  const windows = rangeWindows(range, now);
  const bucket = bucketFor(range);

  if (metric === "credits") {
    const scan = await scanCreditEvents(ids, windows[0]?.startIso ?? "");
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
 * Ledger rows → one bar per bin.
 *
 * ⚠ **BINNED BY A HALF-OPEN COMPARISON ON THE ISO STRING'S INSTANT**, not by
 * arithmetic on a day number: the bins are already `[start, end)` pairs and a
 * row belongs to exactly one of them. A row outside every bin (the scan can
 * return one when the window boundary moves between reads) is DROPPED rather
 * than folded into the nearest bar.
 */
function binCredits(
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
  const { ids, names } = await resolveScope(userId);
  const since = rangeSince(range, now);
  const threadsSince = new Date(
    now.getTime() - RECENT_THREAD_MINUTES * 60_000
  ).toISOString();

  const [
    credits,
    calls,
    msgChannels,
    roles,
    recentThreads,
    liveAgents,
    consent,
    held,
    mentions,
  ] = await Promise.all([
    scanCreditEvents(ids, since),
    scanMcpCalls(ids, since),
    scanMessageChannels(ids, since),
    listContainerRoles(ids),
    // ⚠ WINDOWED SINCE 2026-09-01 — the panel is "threads active in the last
    // RECENT_THREAD_MINUTES", which is its own question and its own window.
    listRecentThreads(ids, THREAD_ROWS, threadsSince),
    listRunningSessions(ids, AGENT_ROWS),
    listPendingConsent(ids, userId),
    listPermissionHeldSessions(ids, userId),
    listUnreadMentions(ids, userId),
  ]);

  const people = await resolvePeople(credits.rows, roles);

  return {
    range,
    since,
    channels: tallyChannels(names, credits.rows, msgChannels.rows),
    people,
    tools: tallyTools(calls.rows),
    threads: mapThreads(recentThreads.rows, names),
    agents: mapAgents(liveAgents.rows, names, userId),
    attention: mapAttention(consent, held, mentions, names, ATTENTION_ROWS),
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
