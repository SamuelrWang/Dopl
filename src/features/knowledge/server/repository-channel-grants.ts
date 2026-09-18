import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelGrantLevel } from "../types";

/**
 * Raw Supabase I/O for CHANNEL RESOURCE GRANTS — the scope-A grant rows behind
 * Home Knowledge Panels. No business logic, no auth checks — those live in
 * `service-channel-grants.ts`.
 *
 * ⚠ THE TABLE IS `resource_grants`, NOT `channel_resource_grants` (Wave B,
 * ruling B4, `20260914120000_resource_grants.sql`). One grant table now carries
 * every scope a resource can be lent to — `channel`, `container`, `team` — so
 * every statement here pins BOTH halves of its slice through
 * {@link CHANNEL_KNOWLEDGE_GRANT}: a missing `scope_type` would read a team's
 * grants as a channel's.
 *
 * ⚠ `channel_id` SURVIVES AS THE PROJECTED NAME. The column is `scope_id`; this
 * module answers questions about CHANNELS, and `channel_id:scope_id` in the
 * select keeps the domain word at the boundary while the storage word stays in
 * the filter. One alias, in one constant, rather than a rename rippling through
 * the service and its callers.
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

const GRANTS_TABLE = "resource_grants";

/**
 * The slice of `resource_grants` this module owns, as an equality filter set for
 * `.match()`. ⚠ STATED ONCE AND SPREAD INTO EVERY STATEMENT, reads and writes
 * alike: the day a second `resource_type` is granted into a channel, a statement
 * that had been hand-spelling its filters would quietly widen.
 */
const CHANNEL_KNOWLEDGE_GRANT = {
  scope_type: "channel",
  resource_type: "knowledge_base",
} as const;

export const CHANNEL_RESOURCE_GRANT_COLS =
  "channel_id:scope_id, resource_type, resource_id, workspace_id, level, guest_write, created_by, created_at, updated_at";

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
 * Every channel ONE knowledge base is granted into — the other direction of the
 * same table, and the query `resource_grants_resource_idx (workspace_id,
 * resource_type, resource_id)` is named for. Behind the settings section, which
 * asks about one KB across many channels rather than one channel across many
 * KBs.
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
 * Create or replace ONE (channel, knowledge_base) grant. `onConflict` names the
 * PK, so a re-grant at a new level UPDATEs in place rather than 23505-ing —
 * "one grant per (kb, channel)" is the PK, and the write states the desired end
 * state rather than a delta.
 *
 * ⚠ `created_by` is only set on INSERT semantics by convention; the upsert
 * overwrites it with the current actor, which is what "who shared this, as it
 * stands" should mean. ⚠ `updated_at` is left to `touch_knowledge_updated_at()`.
 *
 * 🔒 ⚠ `created_by` IS ALSO THE GRANTOR THE VALIDITY TRIGGER JUDGES. Since
 * `20260914120000`, `enforce_resource_grant()` asserts that this user reaches
 * BOTH containers — the base's and the channel's — rather than that the two
 * containers are the same one. Writing a stale or borrowed actor here does not
 * loosen the check; it moves it onto the wrong person.
 *
 * ⚠ The trigger RAISEs `P0001` on a refusal. This function does NOT translate it
 * — the service does, so the raw message (which names both containers, and the
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
 * Drop ONE grant — the storage form of `level: "none"`. Absence IS the third
 * state, so un-sharing is a DELETE and never a row at some lower level.
 *
 * ⚠ `workspace_id`-filtered like every read here: the service-role client
 * bypasses RLS, and the PK alone (scope + type + resource) would let a
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
 * WHICH OF THESE BASES IS SHARED INTO AT LEAST ONE CHANNEL — the read behind the
 * card's `Shared` pill (2026-09-01).
 *
 * ⚠ **ONE `IN (baseIds)` QUERY FOR THE WHOLE GRID, never a lookup per card.** It
 * is the shape `listChannelKnowledgeGrants` already uses; the only difference is
 * that no `scope_id` narrows it, because the question is "any channel at all".
 * Empty `baseIds` short-circuits with no query.
 *
 * ⚠ **ONE COLUMN, AND THE OMISSIONS ARE THE POINT.** It selects `resource_id`
 * alone — not the scope, not `level`, not `created_by`. The caller wants a SET
 * of base ids; every other column would put the identity of channels the caller
 * may not be able to see one `.map()` away from a response body, which is
 * exactly what `listChannelGrantsForBase`'s docblock warns its own caller to
 * intersect against. Answering "yes, somewhere" leaks nothing about where.
 *
 * ⚠ **BOTH LEVELS COUNT.** `agent_only` and `visible` are both a share — the
 * base has left the operator's private shelf either way, and the pill answers
 * "is this still only mine", not "who can read it".
 *
 * ⚠ **AND ONLY CHANNEL SCOPES COUNT**, which is why `CHANNEL_KNOWLEDGE_GRANT`
 * is spread here too. A `team` or `container` grant is a share as well, but this
 * pill is the CHANNEL panel's; widening it silently is how one word starts
 * meaning two things.
 *
 * ⚠ `workspace_id`-filtered like every read in this file: the service passes the
 * RLS-BYPASSING client, so the tenancy fence has to be explicit.
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
  // ⚠ DE-DUPLICATED HERE: a base granted into four channels is four rows and
  // one answer. The SET is the contract (`sharedBaseIds` is a subset of the
  // listed ids), so a caller can `includes` it without counting.
  return [
    ...new Set(
      ((data ?? []) as Array<{ resource_id: string }>).map((r) => r.resource_id)
    ),
  ];
}
