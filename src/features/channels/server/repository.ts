import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type {
  ChannelMemberRow,
  ChannelMessageRow,
  ChannelRow,
  ProfileRef,
} from "./dto";

/**
 * Pure data access for the channels tables. Every function takes the
 * service-role admin client (RLS-bypassing) — visibility + authz are
 * enforced in the service layer. The generated `Database` type does not
 * yet carry the channels tables, so `supabaseAdmin()` (an untyped
 * `SupabaseClient`) accepts the table names and results are cast to the
 * hand-written row types in `dto.ts`.
 */

export function pgErrorCode(err: unknown): string | null {
  if (err && typeof err === "object" && "code" in err) {
    return (err as { code?: string }).code ?? null;
  }
  return null;
}

// ─── Channels ───────────────────────────────────────────────────────

interface ListOpts {
  /** Channel ids the caller is a member of — private channels join here. */
  memberChannelIds: string[];
  includeArchived: boolean;
}

/**
 * Every channel the caller may see: workspace-public ones plus any private
 * channel they belong to. Soft-deleted channels are always excluded.
 */
export async function listChannels(
  workspaceId: string,
  opts: ListOpts
): Promise<ChannelRow[]> {
  const db = supabaseAdmin();
  let query = db
    .from("channels")
    .select("*")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null);
  if (!opts.includeArchived) query = query.is("archived_at", null);
  const orParts = ["visibility.eq.public"];
  if (opts.memberChannelIds.length > 0) {
    orParts.push(`id.in.(${opts.memberChannelIds.join(",")})`);
  }
  query = query.or(orParts.join(","));
  const { data, error } = await query.order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ChannelRow[];
}

export async function findChannelById(
  workspaceId: string,
  channelId: string
): Promise<ChannelRow | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channels")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", channelId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return (data as ChannelRow | null) ?? null;
}

export async function findChannelBySlug(
  workspaceId: string,
  slug: string
): Promise<ChannelRow | null> {
  const db = supabaseAdmin();
  // Escape ilike metacharacters so a slug like "a_b" can't match "axb".
  const literal = slug.replace(/[\\%_]/g, "\\$&");
  const { data, error } = await db
    .from("channels")
    .select("*")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .ilike("slug", literal)
    .maybeSingle();
  if (error) throw error;
  return (data as ChannelRow | null) ?? null;
}

export async function existingSlugs(workspaceId: string): Promise<string[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channels")
    .select("slug")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null);
  if (error) throw error;
  return ((data ?? []) as Array<{ slug: string }>).map((r) => r.slug);
}

type ChannelInsert = {
  workspace_id: string;
  created_by: string;
  slug: string;
  name: string;
  topic: string;
  visibility: string;
};

export async function insertChannel(row: ChannelInsert): Promise<ChannelRow> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channels")
    .insert(row)
    .select("*")
    .single();
  if (error) throw error;
  return data as ChannelRow;
}

type ChannelPatch = Partial<{
  name: string;
  topic: string;
  visibility: string;
  archived_at: string | null;
}>;

export async function updateChannel(
  workspaceId: string,
  channelId: string,
  patch: ChannelPatch
): Promise<ChannelRow> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channels")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("id", channelId)
    .select("*")
    .single();
  if (error) throw error;
  return data as ChannelRow;
}

/** Bump `updated_at` so an active channel sorts to the top of the list. */
export async function touchChannel(
  workspaceId: string,
  channelId: string
): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db
    .from("channels")
    .update({ updated_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("id", channelId);
  if (error) throw error;
}

export async function softDeleteChannel(
  workspaceId: string,
  channelId: string
): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db
    .from("channels")
    .update({ deleted_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("id", channelId);
  if (error) throw error;
}

// ─── Members ────────────────────────────────────────────────────────

/** All channels in the workspace the caller belongs to (ids + role + read). */
export async function listMyMemberships(
  workspaceId: string,
  userId: string
): Promise<ChannelMemberRow[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_members")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId);
  if (error) throw error;
  return (data ?? []) as ChannelMemberRow[];
}

export async function listMembers(
  channelId: string
): Promise<ChannelMemberRow[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_members")
    .select("*")
    .eq("channel_id", channelId)
    .order("joined_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ChannelMemberRow[];
}

export async function findMembership(
  channelId: string,
  userId: string
): Promise<ChannelMemberRow | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_members")
    .select("*")
    .eq("channel_id", channelId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as ChannelMemberRow | null) ?? null;
}

/** Member counts for a set of channels, grouped in JS. */
export async function memberCounts(
  channelIds: string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (channelIds.length === 0) return counts;
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_members")
    .select("channel_id")
    .in("channel_id", channelIds);
  if (error) throw error;
  for (const row of (data ?? []) as Array<{ channel_id: string }>) {
    counts.set(row.channel_id, (counts.get(row.channel_id) ?? 0) + 1);
  }
  return counts;
}

type MemberInsert = {
  channel_id: string;
  user_id: string;
  workspace_id: string;
  role: string;
  added_by: string | null;
};

export async function insertMember(
  row: MemberInsert
): Promise<ChannelMemberRow> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_members")
    .insert(row)
    .select("*")
    .single();
  if (error) throw error;
  return data as ChannelMemberRow;
}

/** Count of members with role='owner' — backs the last-owner-leave guard. */
export async function countOwners(channelId: string): Promise<number> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_members")
    .select("user_id")
    .eq("channel_id", channelId)
    .eq("role", "owner");
  if (error) throw error;
  return (data ?? []).length;
}

export async function deleteMember(
  channelId: string,
  userId: string
): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db
    .from("channel_members")
    .delete()
    .eq("channel_id", channelId)
    .eq("user_id", userId);
  if (error) throw error;
}

/** Best-effort read-watermark bump for a member viewing the thread. */
export async function updateLastRead(
  channelId: string,
  userId: string,
  at: string
): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db
    .from("channel_members")
    .update({ last_read_at: at })
    .eq("channel_id", channelId)
    .eq("user_id", userId);
  if (error) throw error;
}

/**
 * Update a member's OWN per-channel preferences (notify scope and / or agent
 * tool profile); returns the updated membership row. The workspace-guard
 * trigger fires only on UPDATE OF workspace_id/channel_id, so this never
 * trips it.
 */
export async function updateMemberPrefs(
  channelId: string,
  userId: string,
  patch: { notify_scope?: string; agent_tool_profile?: string }
): Promise<ChannelMemberRow> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_members")
    .update(patch)
    .eq("channel_id", channelId)
    .eq("user_id", userId)
    .select("*")
    .single();
  if (error) throw error;
  return data as ChannelMemberRow;
}

// ─── Messages ───────────────────────────────────────────────────────

interface MessageReadOpts {
  since?: number;
  limit: number;
}

/**
 * With a `since` cursor: messages with `seq > since`, ascending, capped at
 * `limit` — the incremental read for MCP / desktop consumers and the await
 * poll. WITHOUT a cursor: the LATEST `limit` messages, returned ascending —
 * so a channel with more than `limit` messages still surfaces its newest
 * posts. The former unconditional oldest-`limit` read silently hid every
 * message past the first page once a channel grew beyond `limit`.
 */
export async function listMessages(
  channelId: string,
  opts: MessageReadOpts
): Promise<ChannelMessageRow[]> {
  const db = supabaseAdmin();
  if (opts.since !== undefined) {
    const { data, error } = await db
      .from("channel_messages")
      .select("*")
      .eq("channel_id", channelId)
      .gt("seq", opts.since)
      .order("seq", { ascending: true })
      .limit(opts.limit);
    if (error) throw error;
    return (data ?? []) as ChannelMessageRow[];
  }
  // Newest `limit`, then flip to ascending for display / cursor semantics.
  const { data, error } = await db
    .from("channel_messages")
    .select("*")
    .eq("channel_id", channelId)
    .order("seq", { ascending: false })
    .limit(opts.limit);
  if (error) throw error;
  return ((data ?? []) as ChannelMessageRow[]).reverse();
}

export async function findMessageByClientId(
  channelId: string,
  clientMsgId: string
): Promise<ChannelMessageRow | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_messages")
    .select("*")
    .eq("channel_id", channelId)
    .eq("client_msg_id", clientMsgId)
    .maybeSingle();
  if (error) throw error;
  return (data as ChannelMessageRow | null) ?? null;
}

type MessageInsert = {
  channel_id: string;
  workspace_id: string;
  author_user_id: string | null;
  author_kind: string;
  kind: string;
  body: string;
  metadata: Record<string, unknown>;
  client_msg_id: string | null;
};

/**
 * Insert a message through the `channel_message_insert` RPC, which takes a
 * per-channel advisory xact lock BEFORE the IDENTITY `seq` is assigned. That
 * serializes seq assignment + commit per channel, so seq commit order is
 * monotonic per channel and an await/read cursor can't advance past a
 * not-yet-visible lower seq and permanently miss it. A unique-violation on
 * `client_msg_id` still surfaces as 23505 for the service layer's idempotency
 * convergence.
 */
export async function insertMessage(
  row: MessageInsert
): Promise<ChannelMessageRow> {
  const db = supabaseAdmin();
  const { data, error } = await db.rpc("channel_message_insert", {
    p_channel_id: row.channel_id,
    p_workspace_id: row.workspace_id,
    p_author_user_id: row.author_user_id,
    p_author_kind: row.author_kind,
    p_kind: row.kind,
    p_body: row.body,
    p_metadata: row.metadata,
    p_client_msg_id: row.client_msg_id,
  });
  if (error) throw error;
  // A single-composite RETURNS comes back as an object; normalize defensively.
  const out = Array.isArray(data) ? data[0] : data;
  return out as ChannelMessageRow;
}

/** Per-channel latest message (seq + created_at) via the bounded RPC. */
export async function lastMessages(
  channelIds: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (channelIds.length === 0) return out;
  const db = supabaseAdmin();
  const { data, error } = await db.rpc("channels_last_message", {
    p_channel_ids: channelIds,
  });
  if (error) throw error;
  for (const row of (data ?? []) as Array<{
    channel_id: string;
    last_at: string;
  }>) {
    out.set(row.channel_id, row.last_at);
  }
  return out;
}

// ─── Workspace membership + profiles ────────────────────────────────

/** True when the user is an ACTIVE member of the workspace (invitee gate). */
export async function isActiveWorkspaceMember(
  workspaceId: string,
  userId: string
): Promise<boolean> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

export async function fetchProfiles(userIds: string[]): Promise<ProfileRef[]> {
  if (userIds.length === 0) return [];
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("profiles")
    .select("id, email, display_name, avatar_url")
    .in("id", userIds);
  if (error) throw error;
  return (data ?? []) as ProfileRef[];
}
