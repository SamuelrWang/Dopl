import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelGrantLevel } from "../types";

/**
 * Raw Supabase I/O for CHANNEL RESOURCE GRANTS (`channel_resource_grants`, the
 * scope-A grant table behind Home Knowledge Panels). No business logic, no auth
 * checks — those live in `service-channel-grants.ts`.
 *
 * ⚠ TAKES A `SupabaseClient` rather than reaching for `supabaseAdmin()` itself.
 * The service passes the service-role client (which BYPASSES RLS), so every
 * method here filters by `workspace_id` EXPLICITLY to keep that bypass
 * contained — the same discipline `repository.ts` states for the KB reads.
 * Passing the client also lets tests drive a fake with no module mock.
 */

export interface ChannelResourceGrantRow {
  channel_id: string;
  resource_type: string;
  resource_id: string;
  workspace_id: string;
  level: ChannelGrantLevel;
  guest_write: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const CHANNEL_RESOURCE_GRANT_COLS =
  "channel_id, resource_type, resource_id, workspace_id, level, guest_write, created_by, created_at, updated_at";

/**
 * Knowledge-base grants on ONE channel, restricted to a base-id set — the
 * bounded fan behind `channelGrants` (one `IN (baseIds)` query, the shape of
 * `listBaseStats`, never a per-row lookup). `workspace_id`-filtered so a
 * service-role read cannot escape the caller's tenancy. Empty `baseIds` short
 * circuits with no query.
 */
export async function listChannelKnowledgeGrants(
  db: SupabaseClient,
  workspaceId: string,
  channelId: string,
  baseIds: string[]
): Promise<ChannelResourceGrantRow[]> {
  if (baseIds.length === 0) return [];
  const { data, error } = await db
    .from("channel_resource_grants")
    .select(CHANNEL_RESOURCE_GRANT_COLS)
    .eq("workspace_id", workspaceId)
    .eq("channel_id", channelId)
    .eq("resource_type", "knowledge_base")
    .in("resource_id", baseIds);
  if (error) throw error;
  return (data ?? []) as ChannelResourceGrantRow[];
}

/**
 * Every channel ONE knowledge base is granted into — the other direction of the
 * same table, and the query `channel_resource_grants_resource_idx
 * (workspace_id, resource_type, resource_id)` is named for. Behind the settings
 * section, which asks about one KB across many channels rather than one channel
 * across many KBs.
 *
 * ⚠ The caller INTERSECTS the result with its own fenced channel list. This
 * returns grants on channels the caller may not see (the KB owner can share
 * into a private room an admin later removed them from), and printing those
 * names would be the leak.
 */
export async function listChannelGrantsForBase(
  db: SupabaseClient,
  workspaceId: string,
  baseId: string,
  limit: number
): Promise<ChannelResourceGrantRow[]> {
  const { data, error } = await db
    .from("channel_resource_grants")
    .select(CHANNEL_RESOURCE_GRANT_COLS)
    .eq("workspace_id", workspaceId)
    .eq("resource_type", "knowledge_base")
    .eq("resource_id", baseId)
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as ChannelResourceGrantRow[];
}

/**
 * Create or replace ONE (channel, knowledge_base) grant. `onConflict` names the
 * PK, so a re-grant at a new level UPDATEs in place rather than 23505-ing —
 * "one grant per (kb, channel)" is the PK, and the write states the desired end
 * state rather than a delta.
 *
 * ⚠ `created_by` is only set on INSERT semantics by convention; the upsert
 * overwrites it with the current actor, which is what "who shared this, as it
 * stands" should mean. ⚠ `updated_at` is left to `touch_knowledge_updated_at()`.
 *
 * ⚠ The same-workspace VALIDITY TRIGGER fires here (BEFORE INSERT OR UPDATE) and
 * RAISEs `P0001` on a mismatch. This function does NOT translate it — the
 * service does, so the raw message (which names both workspace ids) never
 * reaches a client.
 */
export async function upsertChannelKnowledgeGrant(
  db: SupabaseClient,
  row: {
    workspaceId: string;
    channelId: string;
    baseId: string;
    level: ChannelGrantLevel;
    guestWrite: boolean;
    createdBy: string;
  }
): Promise<ChannelResourceGrantRow> {
  const { data, error } = await db
    .from("channel_resource_grants")
    .upsert(
      {
        channel_id: row.channelId,
        resource_type: "knowledge_base",
        resource_id: row.baseId,
        workspace_id: row.workspaceId,
        level: row.level,
        guest_write: row.guestWrite,
        created_by: row.createdBy,
      },
      { onConflict: "channel_id,resource_type,resource_id" }
    )
    .select(CHANNEL_RESOURCE_GRANT_COLS)
    .single();
  if (error) throw error;
  return data as ChannelResourceGrantRow;
}

/**
 * Drop ONE grant — the storage form of `level: "none"`. Absence IS the third
 * state, so un-sharing is a DELETE and never a row at some lower level.
 *
 * ⚠ `workspace_id`-filtered like every read here: the service-role client
 * bypasses RLS, and the PK alone (channel + type + resource) would let a
 * mis-routed call delete another tenant's row. Deleting nothing is SUCCESS —
 * the end state asked for is the end state reached, so a double-click cannot
 * fail.
 */
export async function deleteChannelKnowledgeGrant(
  db: SupabaseClient,
  workspaceId: string,
  channelId: string,
  baseId: string
): Promise<void> {
  const { error } = await db
    .from("channel_resource_grants")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("channel_id", channelId)
    .eq("resource_type", "knowledge_base")
    .eq("resource_id", baseId);
  if (error) throw error;
}
