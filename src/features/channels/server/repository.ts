import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { ChannelMemberRow, ChannelRow, ProfileRef } from "./dto";
import { CHANNEL_MEMBER_ROWS_LIMIT } from "./repository-collab";

/**
 * Pure data access for channels, members, workspace membership + profiles.
 * ⚠ Every function uses the service-role admin client (RLS-BYPASSING) —
 * visibility and authz are enforced in the SERVICE layer, never here.
 *
 * The generated `Database` type does not carry the channels tables, so
 * `supabaseAdmin()` is untyped and results are cast to `dto.ts`'s row types.
 *
 * Siblings: `repository-messages.ts` (transcript), `repository-tasks.ts`,
 * `repository-collab.ts` (consent + trust + presence).
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
 * Every channel the caller may see: workspace-public plus any private channel
 * they belong to. Soft-deleted always excluded.
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

/**
 * The two columns the await hold's per-tick recheck reads: does this channel
 * still exist (not soft-deleted), and is it public? Same filters as
 * {@link findChannelById}, only the projection differs.
 * ⚠ Never use where the DTO is built.
 */
export async function findChannelAccess(
  workspaceId: string,
  channelId: string
): Promise<Pick<ChannelRow, "id" | "visibility"> | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channels")
    .select("id, visibility")
    .eq("workspace_id", workspaceId)
    .eq("id", channelId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return (data as Pick<ChannelRow, "id" | "visibility"> | null) ?? null;
}

export async function findChannelBySlug(
  workspaceId: string,
  slug: string
): Promise<ChannelRow | null> {
  const db = supabaseAdmin();
  // ⚠ Escape ilike metacharacters, or a slug like "a_b" matches "axb".
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
 * Every slug taken in the workspace, INCLUDING soft-deleted channels.
 *
 * ⚠ `channels_workspace_slug_key` is a plain NON-PARTIAL unique index on
 * (workspace_id, lower(slug)), so a soft-deleted row keeps owning its slug.
 * Hiding deleted rows here hands `slugify` a name the index rejects → 409 (or a
 * generic 500 on the DM path) naming a channel the user cannot see.
 *
 * The index stays non-partial on purpose: a soft-deleted DM is REVIVED by name
 * (`findDirectChannelAnyStatus` → `reviveChannel`), which breaks if another
 * channel could take its slug while hidden. Only DMs are hidden rows now.
 */
export async function existingSlugs(workspaceId: string): Promise<string[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channels")
    .select("slug")
    .eq("workspace_id", workspaceId);
  if (error) throw error;
  // ⚠ Index is on lower(slug) — compare in the same case-folded space.
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
 * The direct channel for a member-pair (`direct_key`), INCLUDING a soft-deleted
 * one. Backs both DM dedup and DM revive: the partial unique index counts the
 * soft-deleted row, so a repeat open must find and revive it or 23505.
 * ⚠ Deliberately NO live-rows-only variant — a caller that cannot see the hidden
 * row 500s on a slug/direct_key collision with a channel it cannot read.
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

/**
 * Stamp `deleted_at` — ⚠ **DM ONLY**. Not a trash: on a DM this is the CLOSE
 * half of close/reopen, either side's next open revives the row with its
 * history, and it is a non-creator's only exit from an immutable roster. A
 * tombstoned DM is LIVE PRODUCT STATE (ENGINEERING §7).
 * ⚠ Every other channel goes through {@link hardDeleteChannel} — routing a
 * non-DM here "to be safe" produces a row unreachable in every direction that
 * owns its slug forever.
 */
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

/**
 * Remove the channel row — ⚠ **NON-DM ONLY**. Transcript, membership, threads
 * and everything hanging off it go permanently.
 *
 * ⚠ ONE STATEMENT, and that is why there is NO RPC here. All six child FKs into
 * `channels` are `ON DELETE CASCADE` (members, messages, consent requests,
 * tasks → participants, agents, sessions), so one DELETE is already atomic and
 * complete. Do not add an RPC to "follow the pattern" —
 * `cascade_hard_delete_cluster` needed PL/pgSQL for the OPPOSITE reason
 * (ontology's cascade is over MEMBERSHIP rows, so it had to be composed).
 * The slug comes back with the row (`channels_workspace_slug_key` is
 * non-partial, so only a survivor owns a name).
 */
export async function hardDeleteChannel(
  workspaceId: string,
  channelId: string
): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db
    .from("channels")
    .delete()
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

/**
 * Membership EXISTENCE only — the await hold's per-tick recheck.
 * {@link findMembership} returns the whole row and the recheck reads none of it.
 * ⚠ `maybeSingle()` kept so a duplicate row still surfaces as an error.
 */
export async function hasMembership(
  channelId: string,
  userId: string
): Promise<boolean> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_members")
    .select("user_id")
    .eq("channel_id", channelId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

/**
 * Member counts for a set of channels, grouped in JS.
 *
 * ⚠ BOUND STATED, NOT INHERITED (2026-08-20). PostgREST truncates an un-limited
 * select SILENTLY, and this feeds `Channel.memberCount` — a clipped page is a
 * wrong number on every channel row, not a crash anyone would see.
 */
export async function memberCounts(
  channelIds: string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (channelIds.length === 0) return counts;
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_members")
    .select("channel_id")
    .in("channel_id", channelIds)
    .limit(CHANNEL_MEMBER_ROWS_LIMIT);
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

/** Best-effort read-watermark bump. ⚠ Monotonic at the row level: a concurrent
 *  reader that already advanced past `at` makes this a no-op (no UPDATE, no WAL
 *  event, no realtime fan-out) — the guard that stops refetch loops feeding
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
 * Update a member's OWN per-channel preferences; returns the updated row.
 * The workspace-guard trigger fires only on UPDATE OF workspace_id/channel_id,
 * so this never trips it.
 *
 * ⚠ `favorited_at` is nullable and CLEARING it is a real patch value — the
 * un-favourite is `{ favorited_at: null }`, which is why the type is
 * `string | null` and not `string`. The service builds the patch by checking
 * `!== undefined`, never truthiness (INVARIANTS §8).
 */
export async function updateMemberPrefs(
  channelId: string,
  userId: string,
  patch: {
    notify_scope?: string;
    agent_tool_profile?: string;
    favorited_at?: string | null;
  }
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
