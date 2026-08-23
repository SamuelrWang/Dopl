import "server-only";
import { HttpError } from "@/shared/lib/http-error";
import type {
  OverviewActivityRow,
  OverviewMemberLoadRow,
  OverviewSeriesMetric,
  OverviewSeriesPoint,
  WorkspaceOverview,
  WorkspaceOverviewSeries,
} from "../types";
import {
  countActiveMembers,
  countMcpCallsInWindow,
  countMessagesInWindow,
  countMessagesSince,
  countOpenChannels,
  countRunningSessions,
  countThreadsInWindow,
  listRecentMessages,
  listRecentTasksClosed,
  listRecentTasksOpened,
  listRecentUserMessageAuthors,
  listVisibleChannelRefs,
  type DayWindow,
  type OverviewMessageRow,
  type OverviewTaskRow,
  type VisibleChannelRef,
} from "./repository-overview";
import { listProfileSummaries } from "./repository";

/**
 * Everything behind the desktop Overview page.
 *
 * ⚠ MEMBERSHIP IS NOT CHECKED HERE. Callers resolve membership-scoped first
 * (`segment.ts › resolveApiWorkspace`), exactly as the deleted overview-counts
 * service did — a null resolution IS the denial, and it must land before any of
 * these service-role reads run.
 *
 * TWO FENCING POSTURES, and the split is the point:
 *  - COUNTS and SERIES are workspace-wide aggregate INTEGERS. Reading them
 *    under RLS would clip them to the caller's own channels and label the
 *    result workspace-wide.
 *  - ACTIVITY carries CONTENT (message snippets, thread titles), so it is
 *    fenced to the caller's visible channels server-side, per the members-v2
 *    ruling: filtering in the renderer would still put the rows on the wire.
 */

/** Rows the activity feed shows. */
const ACTIVITY_LIMIT = 8;
/** Chars of message body kept for a preview. Truncated HERE, not in the
 *  renderer — an untruncated body on the wire is the payload we are avoiding. */
const PREVIEW_CHARS = 120;
/** Bars the member-load card shows. */
const MEMBER_LOAD_ROWS = 6;
/** Window the member-load card describes. */
const MEMBER_LOAD_DAYS = 30;
/** See `repository-overview.ts › listRecentUserMessageAuthors` for why a clip
 *  here is honest and a clip in the series would not be. */
const MEMBER_LOAD_SCAN_LIMIT = 10_000;
/** Points in a series: today plus the 30 UTC days before it. */
export const OVERVIEW_SERIES_DAYS = 31;

const SERIES_METRICS: readonly OverviewSeriesMetric[] = [
  "messages",
  "mcp",
  "threads",
];

/** `metric` off the query string, or a 400. ⚠ Never a silent fall-through to a
 *  default — a chart that answers a question nobody asked is worse than an
 *  error (§9). */
export function parseSeriesMetric(raw: string | null): OverviewSeriesMetric {
  const found = SERIES_METRICS.find((m) => m === raw);
  if (!found) {
    throw new HttpError(
      400,
      "INVALID_METRIC",
      `metric must be one of: ${SERIES_METRICS.join(", ")}`
    );
  }
  return found;
}

function utcDayStart(at: Date): Date {
  return new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate())
  );
}

function addDays(at: Date, days: number): Date {
  return new Date(at.getTime() + days * 86_400_000);
}

/** The fixed window: `OVERVIEW_SERIES_DAYS` UTC days ending on `now`'s day. */
export function seriesWindows(now: Date): DayWindow[] {
  const today = utcDayStart(now);
  const windows: DayWindow[] = [];
  for (let i = OVERVIEW_SERIES_DAYS - 1; i >= 0; i--) {
    const start = addDays(today, -i);
    windows.push({
      date: start.toISOString().slice(0, 10),
      startIso: start.toISOString(),
      endIso: addDays(start, 1).toISOString(),
    });
  }
  return windows;
}

/**
 * The daily-binned series behind the histogram — always
 * `OVERVIEW_SERIES_DAYS` points, oldest first, zero-filled, so the renderer
 * never gap-fills. A day with no rows is a real zero here: the bin was counted.
 */
export async function getWorkspaceOverviewSeries(
  workspaceId: string,
  metric: OverviewSeriesMetric,
  now: Date = new Date()
): Promise<WorkspaceOverviewSeries> {
  const counter =
    metric === "messages"
      ? countMessagesInWindow
      : metric === "mcp"
        ? countMcpCallsInWindow
        : countThreadsInWindow;
  const windows = seriesWindows(now);
  const counts = await Promise.all(
    windows.map((win) => counter(workspaceId, win))
  );
  const days: OverviewSeriesPoint[] = windows.map((win, i) => ({
    date: win.date,
    count: counts[i] ?? 0,
  }));
  return { metric, days };
}

function truncate(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_CHARS
    ? `${flat.slice(0, PREVIEW_CHARS - 1)}…`
    : flat;
}

interface ActivityInput {
  messages: OverviewMessageRow[];
  opened: OverviewTaskRow[];
  closed: OverviewTaskRow[];
  channelNames: Map<string, string>;
  names: Map<string, string | null>;
}

/**
 * Merge the three feeds into one newest-first list.
 *
 * ⚠ `thread_closed` rows carry `actorName: null` ON PURPOSE. `channel_tasks`
 * records `closed_at` but no closer, so who closed a thread is a fact this
 * schema does not hold; the contract's "null when unattributable" is that case,
 * and naming the OPENER there would be a fabrication in an audit-shaped feed.
 */
export function mergeActivity(input: ActivityInput): OverviewActivityRow[] {
  const channelName = (id: string) => input.channelNames.get(id) ?? "";
  const rows: OverviewActivityRow[] = [
    ...input.messages.map((m) => ({
      id: `message:${m.id}`,
      channelId: m.channel_id,
      channelName: channelName(m.channel_id),
      kind: "message" as const,
      actorName: m.author_user_id
        ? (input.names.get(m.author_user_id) ?? null)
        : null,
      preview: truncate(m.body),
      at: m.created_at,
    })),
    ...input.opened.map((t) => ({
      id: `thread_opened:${t.id}`,
      channelId: t.channel_id,
      channelName: channelName(t.channel_id),
      kind: "thread_opened" as const,
      actorName: input.names.get(t.created_by) ?? null,
      preview: truncate(t.title),
      at: t.created_at,
    })),
    ...input.closed
      .filter((t): t is OverviewTaskRow & { closed_at: string } =>
        Boolean(t.closed_at)
      )
      .map((t) => ({
        id: `thread_closed:${t.id}`,
        channelId: t.channel_id,
        channelName: channelName(t.channel_id),
        kind: "thread_closed" as const,
        actorName: null,
        preview: truncate(t.title),
        at: t.closed_at,
      })),
  ];
  return rows
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, ACTIVITY_LIMIT);
}

/** Top authors by share of the scanned window, descending. */
export function tallyMemberLoad(
  authorIds: string[],
  names: Map<string, string | null>
): { totalMessages: number; rows: OverviewMemberLoadRow[] } {
  const byUser = new Map<string, number>();
  for (const id of authorIds) byUser.set(id, (byUser.get(id) ?? 0) + 1);
  const total = authorIds.length;
  const rows = [...byUser.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MEMBER_LOAD_ROWS)
    .map(([userId, count]) => ({
      userId,
      name: names.get(userId) ?? "",
      percent: total === 0 ? 0 : Math.round((count / total) * 100),
    }));
  return { totalMessages: total, rows };
}

async function resolveNames(
  userIds: string[]
): Promise<Map<string, string | null>> {
  const unique = [...new Set(userIds)];
  const profiles = await listProfileSummaries(unique);
  const out = new Map<string, string | null>();
  for (const id of unique) {
    const p = profiles.get(id);
    // Same precedence the channels transcript uses: display name, then email.
    out.set(id, p?.displayName || p?.email || null);
  }
  return out;
}

function channelNameMap(refs: VisibleChannelRef[]): Map<string, string> {
  return new Map(refs.map((r) => [r.id, r.name]));
}

/**
 * The whole page in one round trip, minus the histogram (its own route, because
 * the metric is a query PARAMETER the user switches) and credits (already
 * served by `GET /api/billing/status`).
 */
export async function getWorkspaceOverview(
  workspaceId: string,
  userId: string,
  now: Date = new Date()
): Promise<WorkspaceOverview> {
  const midnightUtc = utcDayStart(now).toISOString();
  const memberLoadSince = addDays(utcDayStart(now), -MEMBER_LOAD_DAYS + 1)
    .toISOString();

  const [messagesToday, agentsRunning, members, channels, visible, authorIds] =
    await Promise.all([
      countMessagesSince(workspaceId, midnightUtc),
      countRunningSessions(workspaceId),
      countActiveMembers(workspaceId),
      countOpenChannels(workspaceId),
      listVisibleChannelRefs(workspaceId, userId),
      listRecentUserMessageAuthors(
        workspaceId,
        memberLoadSince,
        MEMBER_LOAD_SCAN_LIMIT
      ),
    ]);

  const channelIds = visible.map((c) => c.id);
  const [messages, opened, closed] = await Promise.all([
    listRecentMessages(channelIds, ACTIVITY_LIMIT),
    listRecentTasksOpened(channelIds, ACTIVITY_LIMIT),
    listRecentTasksClosed(channelIds, ACTIVITY_LIMIT),
  ]);

  const names = await resolveNames([
    ...authorIds,
    ...messages.flatMap((m) => (m.author_user_id ? [m.author_user_id] : [])),
    ...opened.map((t) => t.created_by),
  ]);

  return {
    counts: { messagesToday, agentsRunning, members, channels },
    activity: mergeActivity({
      messages,
      opened,
      closed,
      channelNames: channelNameMap(visible),
      names,
    }),
    memberLoad: tallyMemberLoad(authorIds, names),
  };
}
