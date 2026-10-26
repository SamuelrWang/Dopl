import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { clippedAt, type Clipped } from "@/shared/supabase/max-rows";
import { MCP_CALL_ROWS } from "@/features/analytics/server/mcp-tool-calls";
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
 * ⚠ **THE ARCHIVE FILTER IS DELETED (Samuel's ruling R-21, 2026-09-17).** This
 * read carried `.is("archived_at", null)` on the reasoning that an archived room's
 * traffic is not "recent activity". There is no archived state now, so a channel
 * carrying an old stamp contributes its activity like any other. DMs are INCLUDED —
 * they are channels the caller belongs to, and this feed is the caller's own view,
 * not a workspace broadcast.
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

  // ⚠ `includePublic` is left at its default here, and that is a decision, not
  // an oversight: this fence is only ever reached at `viewer`+ (the overview
  // routes gate at that floor since 2026-08-26), so the guest branch of
  // `visibleChannelsOr` cannot arise and its `null` is unreachable. Guard it
  // anyway — an unreachable branch that returns the WRONG answer if it is ever
  // reached is how a fence stops being one.
  const visible = visibleChannelsOr(memberChannelIds);
  if (visible === null) return [];

  const { data, error } = await db
    .from("channels")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .or(visible)
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

export interface OverviewThreadRow {
  id: string;
  channel_id: string;
  title: string;
  created_by: string;
  created_at: string;
  closed_at: string | null;
}

const MESSAGE_COLS = "id, channel_id, author_user_id, body, created_at";
const THREAD_COLS = "id, channel_id, title, created_by, created_at, closed_at";

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

/** Channels the workspace has: live and NOT direct messages — a DM is a
 *  conversation, not a channel, and the channels page counts neither.
 *  ⚠ **`.is("archived_at", null)` LEFT THIS COUNT ON 2026-09-17 (R-21)** with the
 *  archive feature, so a previously-archived room is counted again. */
export async function countOpenChannels(workspaceId: string): Promise<number> {
  const { count, error } = await supabaseAdmin()
    .from("channels")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
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
export async function listRecentThreadsOpened(
  channelIds: string[],
  limit: number
): Promise<OverviewThreadRow[]> {
  if (channelIds.length === 0) return [];
  const { data, error } = await supabaseAdmin()
    .from("channel_threads")
    .select(THREAD_COLS)
    .in("channel_id", channelIds)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as OverviewThreadRow[];
}

/** Newest threads CLOSED across the already-fenced channel ids. */
export async function listRecentThreadsClosed(
  channelIds: string[],
  limit: number
): Promise<OverviewThreadRow[]> {
  if (channelIds.length === 0) return [];
  const { data, error } = await supabaseAdmin()
    .from("channel_threads")
    .select(THREAD_COLS)
    .in("channel_id", channelIds)
    .not("closed_at", "is", null)
    .order("closed_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as OverviewThreadRow[];
}

/** One author and how many user messages they wrote in the window. */
export interface MessageAuthorTallyRow {
  userId: string;
  messages: number;
}

/** Postgres/PostgREST codes for "that function is not there" — the aggregate
 *  below ships as an UNAPPLIED migration, so the degrade is the LIVE path. */
const RPC_MISSING_CODES = new Set(["PGRST202", "42883"]);

/**
 * USER MESSAGES COUNTED PER AUTHOR, BY POSTGRES — the member-load card since
 * Samuel #2935.
 *
 * 🔒 **IT IS THE DENOMINATOR THAT WAS WRONG, WHICH IS WHY A CLIP WAS NOT
 * SURVIVABLE HERE AFTER ALL.** {@link listRecentUserMessageAuthors} asked for
 * `MEMBER_LOAD_SCAN_LIMIT` (10,000) author ids over 30 days and `max_rows` handed
 * back the newest 1,000, silently; `service-overview.ts › tallyMemberLoad` then
 * published `rows.length` as `totalMessages` under a 30-DAY label and computed
 * every share against it. The superseded argument — "a clip narrows the window
 * but the ratios stay true against the denominator the card shows" — only ever
 * held while that denominator was HONEST and `truncated` was true, and it was
 * neither. One row per author is bounded by the membership.
 *
 * ⚠ **RETURNS `null` WHEN THE FUNCTION IS ABSENT, AND THAT IS NOT AN ERROR** —
 * the migration is written, not applied, so the caller degrades to the capped
 * haul rather than blanking the card. ⚠ A 42P01 is NOT degraded:
 * `channel_messages` has existed since 2026-07-25, so an absent table there is a
 * real fault and must not read as "nobody has written anything".
 */
export async function tallyUserMessageAuthors(
  workspaceId: string,
  sinceIso: string
): Promise<MessageAuthorTallyRow[] | null> {
  const { data, error } = await supabaseAdmin().rpc(
    "workspace_message_author_tally",
    { p_workspace_id: workspaceId, p_since: sinceIso }
  );
  if (error) {
    if (!RPC_MISSING_CODES.has(error.code ?? "")) throw error;
    console.warn(
      `[workspaces/overview] workspace_message_author_tally absent, degrading to the capped scan: ${error.message}`
    );
    return null;
  }
  const rows: MessageAuthorTallyRow[] = [];
  for (const row of (data ?? []) as Array<{
    author_id: string | null;
    messages: number | string;
  }>) {
    // ⚠ The SQL already excludes a null author (a deleted account). Dropping it
    // again here keeps "Unknown" out of a per-person card if that ever loosens.
    if (!row.author_id) continue;
    // ⚠ `bigint` crosses the wire as a STRING; unconverted, the card's total
    // becomes concatenation.
    rows.push({ userId: row.author_id, messages: Number(row.messages) });
  }
  return rows;
}

/**
 * Author ids of user-authored messages in the window, NEWEST FIRST — the
 * member-load card's DEGRADE path, kept for the days before the aggregate above
 * is applied.
 *
 * ⚠ **IT IS A FLOOR AND IT FINALLY SAYS SO.** `limit` is above `max_rows`, so the
 * server clips this to 1,000 and raises nothing; `clippedAt` compares against the
 * EFFECTIVE ceiling, where the superseded `rows.length >= limit` compared against
 * the asked 10,000 and could never fire. The caller logs the clip — the payload
 * has no field for it (`types.ts › WorkspaceOverview.memberLoad`), and the right
 * answer to that is {@link tallyUserMessageAuthors}, not a wider haul.
 */
export async function listRecentUserMessageAuthors(
  workspaceId: string,
  sinceIso: string,
  limit: number
): Promise<Clipped<string>> {
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
  return clippedAt(
    ((data ?? []) as Array<{ author_user_id: string }>).map(
      (r) => r.author_user_id
    ),
    limit
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
    .or("tool.neq.channel,op.not.like.await*")
    .not("tool", "like", MCP_CALL_ROWS);
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
    .from("channel_threads")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .gte("created_at", win.startIso)
    .lt("created_at", win.endIso);
  if (channelId) query = query.eq("channel_id", channelId);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}
