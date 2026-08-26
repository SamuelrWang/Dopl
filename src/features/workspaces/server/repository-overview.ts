import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { visibleChannelsOr } from "@/features/channels/server/repository-visibility";

/**
 * Pure data access for the desktop Overview page: four head-counts, the three
 * feeds its activity list merges, the 30-day member-load scan, and the daily
 * bins behind the histogram.
 *
 * ⚠ Every function here uses the service-role admin client (RLS-BYPASSING).
 * The counts and the series are WORKSPACE-WIDE on purpose — they are aggregate
 * integers, and RLS would silently clip them to the caller's own channels,
 * which turns "messages today" into a per-caller number wearing a
 * workspace-wide label. The ACTIVITY feed is the opposite case: it carries
 * CONTENT, so {@link listVisibleChannelRefs} computes its fence from the
 * channels feature's one visibility statement and every activity read below
 * takes the resulting id list AS ITS ENTIRE FENCE. ⚠ Never build that array
 * from anything a caller sent.
 *
 * The generated `Database` type does not carry the channels tables, so
 * `supabaseAdmin()` is untyped here and results are cast at the boundary.
 */

/**
 * Ceiling on the fence read. ⚠ PostgREST truncates an un-limited select
 * SILENTLY; a workspace's channel count is far below this, so the limit exists
 * to make truncation loud rather than to bound anything anyone will reach. Same
 * number, same reason, as `repository-await-workspace.ts`'s.
 */
const VISIBLE_CHANNEL_LIMIT = 500;

/** Id + display name — the two columns a merged, cross-table feed needs to say
 *  WHERE a row came from. */
export interface VisibleChannelRef {
  id: string;
  name: string;
}

/**
 * THE ACTIVITY FEED'S FENCE — every live channel this caller may see.
 *
 * ⚠ The predicate is NOT re-derived here: it is
 * `channels/server/repository-visibility.ts › visibleChannelsOr`, the one
 * statement `listChannels` also builds from, so the overview and the channels
 * page can never disagree about what "visible" means. Everything downstream
 * takes the returned ids AS THE ENTIRE FENCE, because every activity read runs
 * on the RLS-bypassing admin client.
 *
 * Archived channels are excluded: an archived room's traffic is not "recent
 * activity". DMs are INCLUDED — they are channels the caller belongs to, and
 * this feed is the caller's own view, not a workspace broadcast.
 */
export async function listVisibleChannelRefs(
  workspaceId: string,
  userId: string
): Promise<VisibleChannelRef[]> {
  const db = supabaseAdmin();
  const { data: memberships, error: memberError } = await db
    .from("channel_members")
    .select("channel_id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .limit(VISIBLE_CHANNEL_LIMIT);
  if (memberError) throw memberError;
  const memberChannelIds = (
    (memberships ?? []) as Array<{ channel_id: string }>
  ).map((m) => m.channel_id);

  const { data, error } = await db
    .from("channels")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .is("archived_at", null)
    .or(visibleChannelsOr(memberChannelIds))
    .order("updated_at", { ascending: false })
    .limit(VISIBLE_CHANNEL_LIMIT);
  if (error) throw error;
  return (data ?? []) as VisibleChannelRef[];
}

/** Rows the activity merge reads. Narrow by design — no `metadata`, no body of
 *  a non-`message` kind, nothing the feed does not render. */
export interface OverviewMessageRow {
  id: string;
  channel_id: string;
  author_user_id: string | null;
  body: string;
  created_at: string;
}

export interface OverviewTaskRow {
  id: string;
  channel_id: string;
  title: string;
  created_by: string;
  created_at: string;
  closed_at: string | null;
}

const MESSAGE_COLS = "id, channel_id, author_user_id, body, created_at";
const TASK_COLS = "id, channel_id, title, created_by, created_at, closed_at";

/** `channel_messages` of kind `message` created at or after `sinceIso`. */
export async function countMessagesSince(
  workspaceId: string,
  sinceIso: string
): Promise<number> {
  const { count, error } = await supabaseAdmin()
    .from("channel_messages")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("kind", "message")
    .gte("created_at", sinceIso);
  if (error) throw error;
  return count ?? 0;
}

/** Live agent sessions: anything the desktop has not reported as `ended`. */
export async function countRunningSessions(workspaceId: string): Promise<number> {
  const { count, error } = await supabaseAdmin()
    .from("channel_sessions")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .neq("state", "ended");
  if (error) throw error;
  return count ?? 0;
}

/** ⚠ ACTIVE memberships only — a pending invitation is not a member, and a
 *  revoked one stopped being one. */
export async function countActiveMembers(workspaceId: string): Promise<number> {
  const { count, error } = await supabaseAdmin()
    .from("workspace_members")
    .select("user_id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("status", "active");
  if (error) throw error;
  return count ?? 0;
}

/** Channels the workspace has: live, unarchived, and NOT direct messages — a
 *  DM is a conversation, not a channel, and the channels page counts neither. */
export async function countOpenChannels(workspaceId: string): Promise<number> {
  const { count, error } = await supabaseAdmin()
    .from("channels")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .is("archived_at", null)
    .eq("is_direct", false);
  if (error) throw error;
  return count ?? 0;
}

/** Newest `message` rows across the already-fenced channel ids. */
export async function listRecentMessages(
  channelIds: string[],
  limit: number
): Promise<OverviewMessageRow[]> {
  if (channelIds.length === 0) return [];
  const { data, error } = await supabaseAdmin()
    .from("channel_messages")
    .select(MESSAGE_COLS)
    .in("channel_id", channelIds)
    .eq("kind", "message")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as OverviewMessageRow[];
}

/** Newest threads OPENED across the already-fenced channel ids. */
export async function listRecentTasksOpened(
  channelIds: string[],
  limit: number
): Promise<OverviewTaskRow[]> {
  if (channelIds.length === 0) return [];
  const { data, error } = await supabaseAdmin()
    .from("channel_tasks")
    .select(TASK_COLS)
    .in("channel_id", channelIds)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as OverviewTaskRow[];
}

/** Newest threads CLOSED across the already-fenced channel ids. */
export async function listRecentTasksClosed(
  channelIds: string[],
  limit: number
): Promise<OverviewTaskRow[]> {
  if (channelIds.length === 0) return [];
  const { data, error } = await supabaseAdmin()
    .from("channel_tasks")
    .select(TASK_COLS)
    .in("channel_id", channelIds)
    .not("closed_at", "is", null)
    .order("closed_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as OverviewTaskRow[];
}

/**
 * Author ids of user-authored messages in the window, NEWEST FIRST.
 *
 * ⚠ THIS ONE READ HAULS ROWS, and the ordering is the reason it is allowed to.
 * The member-load card is a set of RATIOS: clipping at `limit` narrows the
 * window the ratios describe (to the most recent `limit` messages) but leaves
 * every ratio true against the denominator the card reports beside them. The
 * SERIES cannot make that trade — a clipped day reads as zero, which is a
 * measurement nobody took — so it bins with per-day counts instead.
 */
export async function listRecentUserMessageAuthors(
  workspaceId: string,
  sinceIso: string,
  limit: number
): Promise<string[]> {
  const { data, error } = await supabaseAdmin()
    .from("channel_messages")
    .select("author_user_id")
    .eq("workspace_id", workspaceId)
    .eq("kind", "message")
    .eq("author_kind", "user")
    .gte("created_at", sinceIso)
    .not("author_user_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return ((data ?? []) as Array<{ author_user_id: string }>).map(
    (r) => r.author_user_id
  );
}

/** One UTC-day bin, `[startIso, endIso)`. */
export interface DayWindow {
  date: string;
  startIso: string;
  endIso: string;
}

/**
 * Count `channel_messages` of kind `message` in one day window.
 *
 * ⚠ ONE STATEMENT PER BIN, rather than one read hauling 31 days of timestamps
 * for the client to group. A hauling read needs a `limit` (§9), and a clipped
 * series does not render as clipped — the oldest bins render as ZERO, which is
 * a measurement nobody took, drawn as fact. Counting per bin has no such cliff.
 * Once `20260822170000_overview_time_range_indexes.sql` is applied these are
 * index-range counts on `(workspace_id, created_at)`; until then they are seq
 * scans — slow, never wrong.
 */
export async function countMessagesInWindow(
  workspaceId: string,
  win: DayWindow,
  channelId: string | null = null
): Promise<number> {
  let query = supabaseAdmin()
    .from("channel_messages")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("kind", "message")
    .gte("created_at", win.startIso)
    .lt("created_at", win.endIso);
  // ⚠ NARROWED, NEVER RE-FENCED. `channelId` reaches here only after the route
  // has proved the caller may SEE that channel against
  // `listVisibleChannelRefs` — this clause is a SCOPE, and the `workspace_id`
  // equality above stays the fence (§2: service role bypasses RLS, so the
  // caller-supplied id must never be the only thing standing between a reader
  // and a count).
  if (channelId) query = query.eq("channel_id", channelId);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

/**
 * Count `mcp_tool_calls` in one day window, EXCLUDING await-polling noise.
 *
 * ⚠ `mcp_tool_calls` rows are logged per LOOPBACK REQUEST at the API choke
 * point, not per tool call the agent made. `dopl_channel`'s await ops poll, so
 * one logical "wait for a reply" writes a row per tick and would dominate the
 * histogram; De Morgan turns `NOT (tool='channel' AND op LIKE 'await%')` into
 * the `or=` below. RESIDUAL CAVEAT, deliberately not filtered: a single
 * `dopl_map` call fans out to several loopback reads and still counts more than
 * once. This metric is a SHAPE (is MCP usage rising?), never a call tally.
 */
export async function countMcpCallsInWindow(
  workspaceId: string,
  win: DayWindow
): Promise<number> {
  const { count, error } = await supabaseAdmin()
    .from("mcp_tool_calls")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .gte("created_at", win.startIso)
    .lt("created_at", win.endIso)
    .or("tool.neq.channel,op.not.like.await*");
  if (error) throw error;
  return count ?? 0;
}

/** Count threads opened in one day window. `channelId` narrows exactly as
 *  {@link countMessagesInWindow}'s does, under the same proved-visible rule. */
export async function countThreadsInWindow(
  workspaceId: string,
  win: DayWindow,
  channelId: string | null = null
): Promise<number> {
  let query = supabaseAdmin()
    .from("channel_tasks")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .gte("created_at", win.startIso)
    .lt("created_at", win.endIso);
  if (channelId) query = query.eq("channel_id", channelId);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}
