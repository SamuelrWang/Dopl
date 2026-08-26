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
