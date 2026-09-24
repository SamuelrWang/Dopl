import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { ChannelInfoCardInput } from "../info-card";
import type { ChannelRow } from "./dto";
import { visibleChannelsOr } from "./repository-visibility";

/**
 * Pure data access for channels, members, workspace membership + profiles.
 * ⚠ Every function uses the service-role admin client (RLS-BYPASSING) —
 * visibility and authz are enforced in the SERVICE layer, never here.
 *
 * The generated `Database` type does not carry the channels tables, so
 * `supabaseAdmin()` is untyped and results are cast to `dto.ts`'s row types.
 *
 * Siblings: `repository-messages.ts` (transcript), `repository-tasks.ts`,
 * `repository-collab.ts` (consent + trust + presence),
 * `repository-members.ts` (the `channel_members` table) and
 * `repository-workspace.ts` (workspace membership + profiles), both re-exported here.
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
  /** ⚠ `false` for a GUEST (`service-shared.ts › mayReadPublicChannels`). */
  includePublic?: boolean;
}

/**
 * Every channel the caller may see: workspace-public plus any private channel
 * they belong to. Soft-deleted always excluded. ⚠ A `null` predicate = may see
 * NOTHING; PostgREST rejects a no-term `or`, so answer the empty list.
 *
 * 🔴 **THE ARCHIVE FILTER IS DELETED (Samuel's ruling R-21, 2026-09-17).** This
 * query carried `.is("archived_at", null)` unless a caller opted out of it, and
 * that one line was what made an archived channel disappear from every list.
 * **Channels that carry an old `archived_at` stamp now come back as ordinary
 * channels** — which is the intended outcome, not a side effect: there is no
 * archived state any more, so nothing may hide a row for having one. ⚠ **The
 * COLUMN is still there** and nothing writes it; dropping it is a later wave's
 * migration (WRITTEN NOT APPLIED under `supabase/migrations/`). ⚠ **`deleted_at`
 * is a different thing and still filters** — a tombstoned channel is NOT-FOUND to
 * every read.
 */
export async function listChannels(
  workspaceId: string,
  opts: ListOpts
): Promise<ChannelRow[]> {
  const visible = visibleChannelsOr(opts.memberChannelIds, opts);
  if (visible === null) return [];
  const db = supabaseAdmin();
  let query = db
    .from("channels")
    .select("*")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null);
  query = query.or(visible);
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
  /** The curated Main-info card, already validated by
   *  `info-card.ts › ChannelInfoCardSchema` at the route boundary. */
  info_card: ChannelInfoCardInput;
  // ⚠ **THE POSTURE CEILING IS DELETED FROM THIS PATCH (2026-09-06, items 12, 13, 14)** —
  // `agent_tool_ceiling`, `agent_message_ceiling`, `agent_chain_allowed`. Nothing writes them
  // and nothing reads them; the COLUMNS remain on the table under a non-destructive migration,
  // because clearing values nothing reads is destruction with no beneficiary.
  //
  // ⚠ REMOVING THEM FROM THIS TYPE IS PART OF THE FENCE, NOT TIDYING. `ChannelPatch` is what
  // `updateChannel` accepts; a field left here would let a future caller write a ceiling that
  // no reader would ever honour — a value in the database that means nothing, which is worse
  // than either keeping the feature or removing it.
  //
  // ⚠ **`default_responder_agent_name` IS OFF THIS PATCH TOO (2026-09-07, items 10 and 11)**,
  // and for the fence's reason above rather than for tidiness: nothing reads the column any
  // more, so leaving it settable would let a future caller store a nomination no resolver will
  // ever honour. That is the same "value in the database that means nothing" the ceiling trio
  // was removed to prevent. The per-member replacement is written through
  // `updateMemberPrefs`, against `channel_members`, and never through this type.
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
 * `cascade_hard_delete_ontology` needed PL/pgSQL for the OPPOSITE reason
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
// ⚠ EXTRACTED 2026-09-14 to `repository-members.ts` — this file hit the cap
// again, the same way and with the same remedy as the workspace band below.
// Re-exported so `import * as repo from "./repository"` is unchanged (§1).
export {
  countOwners,
  deleteMember,
  findMembership,
  findUnaddressedResponder,
  hasMembership,
  insertMember,
  listMembers,
  listMyMemberships,
  memberCounts,
  updateLastRead,
  updateMemberPrefs,
} from "./repository-members";

// ─── Workspace membership + profiles ────────────────────────────────
// ⚠ EXTRACTED 2026-08-26 to `repository-workspace.ts` — this file hit the cap.
// Re-exported so `import * as repo from "./repository"` is unchanged (§1).
export {
  isActiveWorkspaceMember,
  fetchProfiles,
} from "./repository-workspace";
