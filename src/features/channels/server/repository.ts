import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { ChannelMemberRow, ChannelRow, ProfileRef } from "./dto";

/**
 * Pure data access for the channels tables — channels, members, workspace
 * membership + profiles. Every function takes the service-role admin client
 * (RLS-bypassing); visibility + authz are enforced in the service layer. The
 * generated `Database` type does not yet carry the channels tables, so
 * `supabaseAdmin()` (an untyped `SupabaseClient`) accepts the table names and
 * results are cast to the hand-written row types in `dto.ts`.
 *
 * Siblings (§2 500-line cap): `repository-messages.ts` (the transcript),
 * `repository-tasks.ts` (`channel_tasks`), `repository-collab.ts` (consent +
 * trust + presence).
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

/**
 * Every slug already taken in the workspace — INCLUDING soft-deleted channels.
 * `channels_workspace_slug_key` is a plain (non-partial) unique index on
 * (workspace_id, lower(slug)), so a soft-deleted row keeps owning its slug: a
 * read that hid deleted rows handed `slugify` a name the index would reject,
 * turning "delete #design, create #design again" into a 409 naming a channel
 * the user can no longer see (and, on the DM path, a generic 500). The index
 * stays non-partial on purpose — a soft-deleted DM is REVIVED by name
 * (`findDirectChannelAnyStatus` → `reviveChannel`), which would break if
 * another channel could take its slug while it was hidden.
 */
export async function existingSlugs(workspaceId: string): Promise<string[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channels")
    .select("slug")
    .eq("workspace_id", workspaceId);
  if (error) throw error;
  // The index is on lower(slug); compare in the same case-folded space.
  return ((data ?? []) as Array<{ slug: string }>).map((r) =>
    r.slug.toLowerCase()
  );
}

type ChannelInsert = {
  workspace_id: string;
  created_by: string;
  slug: string;
  name: string;
  topic: string;
  visibility: string;
  is_direct?: boolean;
  direct_key?: string | null;
};

/**
 * The direct channel for a member-pair (`direct_key`) in a workspace INCLUDING
 * a soft-deleted one, or null. Backs both the DM dedup (a repeat "open direct
 * message" returns the existing channel instead of inserting a second) and the
 * DM revive: the partial unique index counts the soft-deleted row, so a repeat
 * open must find and revive it rather than insert a second (which would
 * 23505). There is deliberately no live-rows-only variant — every caller that
 * converges on a DM has to see the hidden row, or it 500s on a slug/direct_key
 * collision with a channel it cannot read.
 */
export async function findDirectChannelAnyStatus(
  workspaceId: string,
  directKey: string
): Promise<ChannelRow | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channels")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("is_direct", true)
    .eq("direct_key", directKey)
    .maybeSingle();
  if (error) throw error;
  return (data as ChannelRow | null) ?? null;
}

/** Clear `deleted_at` — un-hide a soft-deleted channel (DM reopen / revive). */
export async function reviveChannel(
  workspaceId: string,
  channelId: string
): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db
    .from("channels")
    .update({ deleted_at: null, updated_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("id", channelId);
  if (error) throw error;
}

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

/** Best-effort read-watermark bump for a member viewing the thread.
 *  Monotonic at the row level: a concurrent reader that already advanced the
 *  watermark past `at` turns this into a no-op (no UPDATE, no WAL event, no
 *  realtime fan-out) — the guard that keeps refetch loops from feeding
 *  themselves. */
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
    .eq("user_id", userId)
    .or(`last_read_at.is.null,last_read_at.lt.${at}`);
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
