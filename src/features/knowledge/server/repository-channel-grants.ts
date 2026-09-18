import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelGrantLevel } from "../types";

/**
 * Raw Supabase I/O for channel resource grants. No business logic, no auth
 * checks — those live in `service-channel-grants.ts`.
 *
 * The table is `resource_grants` and carries every scope a resource can be lent
 * to (`channel`, `container`, `team`), so every statement pins both halves of
 * its slice through {@link CHANNEL_KNOWLEDGE_GRANT}: a missing `scope_type`
 * would read a team's grants as a channel's. The column is `scope_id`;
 * `channel_id:scope_id` in the select keeps the domain word at the boundary.
 *
 * Takes a `SupabaseClient` rather than reaching for `supabaseAdmin()`. The
 * service passes the RLS-bypassing service-role client, so every method here
 * filters by `workspace_id` explicitly to keep that bypass contained.
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

const GRANTS_TABLE = "resource_grants";

/**
 * The slice of `resource_grants` this module owns, as an equality filter set for
 * `.match()`. Stated once and spread into every statement: the day a second
 * `resource_type` is granted into a channel, a hand-spelled filter would widen.
 */
const CHANNEL_KNOWLEDGE_GRANT = {
  scope_type: "channel",
  resource_type: "knowledge_base",
} as const;

export const CHANNEL_RESOURCE_GRANT_COLS =
  "channel_id:scope_id, resource_type, resource_id, workspace_id, level, guest_write, created_by, created_at, updated_at";

/**
 * Knowledge-base grants on one channel, restricted to a base-id set — one
 * `IN (baseIds)` query, never a per-row lookup. `workspace_id`-filtered so a
 * service-role read cannot escape the caller's tenancy.
 */
export async function listChannelKnowledgeGrants(
  db: SupabaseClient,
  workspaceId: string,
  channelId: string,
  baseIds: string[]
): Promise<ChannelResourceGrantRow[]> {
  if (baseIds.length === 0) return [];
  const { data, error } = await db
    .from(GRANTS_TABLE)
    .select(CHANNEL_RESOURCE_GRANT_COLS)
    .match({
      workspace_id: workspaceId,
      scope_id: channelId,
      ...CHANNEL_KNOWLEDGE_GRANT,
    })
    .in("resource_id", baseIds);
  if (error) throw error;
  return (data ?? []) as unknown as ChannelResourceGrantRow[];
}

/**
 * Every channel one knowledge base is granted into — the other direction of the
 * same table, served by `resource_grants_resource_idx`.
 *
 * The caller must intersect the result with its own fenced channel list: this
 * returns grants on channels the caller may not see, and printing those names
 * would be the leak.
 */
export async function listChannelGrantsForBase(
  db: SupabaseClient,
  workspaceId: string,
  baseId: string,
  limit: number
): Promise<ChannelResourceGrantRow[]> {
  const { data, error } = await db
    .from(GRANTS_TABLE)
    .select(CHANNEL_RESOURCE_GRANT_COLS)
    .match({
      workspace_id: workspaceId,
      resource_id: baseId,
      ...CHANNEL_KNOWLEDGE_GRANT,
    })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as ChannelResourceGrantRow[];
}

/**
 * Create or replace one (channel, knowledge_base) grant. `onConflict` names the
 * PK, so a re-grant at a new level updates in place rather than 23505-ing.
 * `updated_at` is left to `touch_knowledge_updated_at()`.
 *
 * `created_by` is the grantor `enforce_resource_grant()` judges: it asserts that
 * this user reaches both containers, the base's and the channel's. A stale or
 * borrowed actor here does not loosen the check, it moves it onto the wrong
 * person.
 *
 * The trigger RAISEs `P0001` on a refusal and this function does not translate
 * it — the service does, so the raw message (which names both containers and the
 * grantor) never reaches a client.
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
    .from(GRANTS_TABLE)
    .upsert(
      {
        ...CHANNEL_KNOWLEDGE_GRANT,
        scope_id: row.channelId,
        resource_id: row.baseId,
        workspace_id: row.workspaceId,
        level: row.level,
        guest_write: row.guestWrite,
        created_by: row.createdBy,
      },
      { onConflict: "scope_type,scope_id,resource_type,resource_id" }
    )
    .select(CHANNEL_RESOURCE_GRANT_COLS)
    .single();
  if (error) throw error;
  return data as unknown as ChannelResourceGrantRow;
}

/**
 * Drop one grant — the storage form of `level: "none"`. Absence is the third
 * state, so un-sharing is a DELETE, never a row at some lower level.
 *
 * `workspace_id`-filtered: the service-role client bypasses RLS, and the PK
 * alone would let a mis-routed call delete another tenant's row. Deleting
 * nothing is success, so a double-click cannot fail.
 */
export async function deleteChannelKnowledgeGrant(
  db: SupabaseClient,
  workspaceId: string,
  channelId: string,
  baseId: string
): Promise<void> {
  const { error } = await db
    .from(GRANTS_TABLE)
    .delete()
    .match({
      workspace_id: workspaceId,
      scope_id: channelId,
      resource_id: baseId,
      ...CHANNEL_KNOWLEDGE_GRANT,
    });
  if (error) throw error;
}

/**
 * Which of these bases is shared into at least one channel — the read behind the
 * card's `Shared` pill. One `IN (baseIds)` query for the whole grid, with no
 * `scope_id` narrowing it because the question is "any channel at all".
 *
 * It selects `resource_id` alone; every other column would put the identity of
 * channels the caller may not see one `.map()` from a response body. Answering
 * "yes, somewhere" leaks nothing about where.
 *
 * Both levels count — the base has left the private shelf either way — but only
 * channel scopes do, hence the `CHANNEL_KNOWLEDGE_GRANT` spread.
 * `workspace_id`-filtered because the client bypasses RLS.
 */
export async function listSharedBaseIds(
  db: SupabaseClient,
  workspaceId: string,
  baseIds: string[],
  limit: number
): Promise<string[]> {
  if (baseIds.length === 0) return [];
  const { data, error } = await db
    .from(GRANTS_TABLE)
    .select("resource_id")
    .match({ workspace_id: workspaceId, ...CHANNEL_KNOWLEDGE_GRANT })
    .in("resource_id", baseIds)
    .limit(limit);
  if (error) throw error;
  // De-duplicated: a base granted into four channels is four rows and one
  // answer. The set is the contract, so a caller can `includes` it.
  return [
    ...new Set(
      ((data ?? []) as Array<{ resource_id: string }>).map((r) => r.resource_id)
    ),
  ];
}
