import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { AccessMode, TeamResourceType } from "../access-levels";

/**
 * THE GRANTABLE RESOURCES THEMSELVES — the only part of the teams repository
 * that reads or writes another feature's table, split out of `repository.ts`
 * (2026-08-08, §2 cap). A grant row says WHICH resource; these functions are
 * what knows where that resource lives, what its name column is called and who
 * counts as its creator. `repository-grants.ts` owns the rows that point here.
 *
 * Raw Supabase I/O, every query filtered by `workspace_id` (§8).
 */

export interface TeamsModeResourceRow {
  resourceType: TeamResourceType;
  resourceId: string;
  createdBy: string | null;
}

/** Every teams-mode resource in the workspace (live KBs + workflows + skills). */
export async function listTeamsModeResources(
  workspaceId: string
): Promise<TeamsModeResourceRow[]> {
  const db = supabaseAdmin();
  const [kbs, wfs, skills] = await Promise.all([
    db
      .from("knowledge_bases")
      .select("id, created_by")
      .eq("workspace_id", workspaceId)
      .eq("access_mode", "teams")
      .is("deleted_at", null),
    db
      .from("workflows")
      .select("id, user_id")
      .eq("workspace_id", workspaceId)
      .eq("access_mode", "teams")
      .is("deleted_at", null),
    db
      .from("skills")
      .select("id, created_by")
      .eq("workspace_id", workspaceId)
      .eq("access_mode", "teams")
      .is("deleted_at", null),
  ]);
  if (kbs.error) throw kbs.error;
  if (wfs.error) throw wfs.error;
  if (skills.error) throw skills.error;
  return [
    ...((kbs.data ?? []) as Array<{ id: string; created_by: string | null }>).map(
      (r) => ({
        resourceType: "knowledge_base" as const,
        resourceId: r.id,
        createdBy: r.created_by,
      })
    ),
    ...((wfs.data ?? []) as Array<{ id: string; user_id: string | null }>).map(
      (r) => ({
        resourceType: "workflow" as const,
        resourceId: r.id,
        createdBy: r.user_id,
      })
    ),
    ...((skills.data ?? []) as Array<{ id: string; created_by: string | null }>).map(
      (r) => ({
        resourceType: "skill" as const,
        resourceId: r.id,
        createdBy: r.created_by,
      })
    ),
  ];
}

/** name + access_mode for a batch of live KBs (invariant checks). */
export async function listKnowledgeBaseAccessMetas(
  workspaceId: string,
  kbIds: string[]
): Promise<Array<{ id: string; name: string; accessMode: AccessMode }>> {
  if (kbIds.length === 0) return [];
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("knowledge_bases")
    .select("id, name, access_mode")
    .eq("workspace_id", workspaceId)
    .in("id", kbIds)
    .is("deleted_at", null);
  if (error) throw error;
  return ((data ?? []) as Array<{ id: string; name: string; access_mode: AccessMode }>).map(
    (r) => ({ id: r.id, name: r.name, accessMode: r.access_mode })
  );
}

export interface ResourceAccessMeta {
  name: string;
  accessMode: AccessMode;
  createdBy: string | null;
}

/**
 * WHERE EACH GRANTABLE RESOURCE TYPE ACTUALLY LIVES.
 *
 * `team_resource_access.resource_id` is polymorphic across FIVE tables, and
 * every one of them spells "the name" and "the creator" differently. The two
 * functions below used to decide the table with an inline ternary each —
 * `knowledge_base ? … : workflows` — which silently routed `skill`, `chat` and
 * `chat_folder` into `workflows`. A Supabase `.update()` that matches zero rows
 * returns `{ error: null }`, so the miss did not throw, did not 500, and did
 * not change anything: a skill's scope toggle "succeeded" and reverted on the
 * next refetch.
 *
 * `satisfies Record<TeamResourceType, …>` is the load-bearing part — adding a
 * sixth resource type now fails to compile here instead of quietly resolving to
 * the wrong table.
 */
const RESOURCE_TABLES = {
  knowledge_base: { table: "knowledge_bases", nameCol: "name", creatorCol: "created_by" },
  workflow: { table: "workflows", nameCol: "name", creatorCol: "user_id" },
  skill: { table: "skills", nameCol: "name", creatorCol: "created_by" },
  chat: { table: "chats", nameCol: "title", creatorCol: "owner_id" },
  chat_folder: { table: "chat_folders", nameCol: "name", creatorCol: "user_id" },
} satisfies Record<
  TeamResourceType,
  { table: string; nameCol: string; creatorCol: string }
>;

/**
 * access_mode + creator + name for one resource; null if missing.
 * Soft-deleted KBs are INCLUDED on purpose: access checks must still
 * resolve for trash restore (existence gating for reads happens in the
 * knowledge service's own lookups, which already exclude deleted rows).
 */
export async function getResourceAccessMeta(
  workspaceId: string,
  resourceType: TeamResourceType,
  resourceId: string
): Promise<ResourceAccessMeta | null> {
  const spec = RESOURCE_TABLES[resourceType];
  const db = supabaseAdmin();
  const { data, error } = await db
    .from(spec.table)
    .select(`${spec.nameCol}, access_mode, ${spec.creatorCol}`)
    .eq("workspace_id", workspaceId)
    .eq("id", resourceId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  // Double cast: the projection is a template literal, which supabase-js's
  // select-string parser can't resolve to a row type (it yields a ParserError).
  // The columns come from RESOURCE_TABLES, so the shape is known here.
  const row = data as unknown as Record<string, unknown>;
  return {
    name: row[spec.nameCol] as string,
    accessMode: row.access_mode as AccessMode,
    createdBy: (row[spec.creatorCol] as string | null) ?? null,
  };
}

/**
 * Flip one resource row between `workspace` and `teams` scope.
 *
 * CHATS AND CHAT FOLDERS ARE REFUSED, not routed. Their scope is not a column
 * you may set in isolation: a folder's scope is authoritative for every chat
 * filed in it and is PROPAGATED to those rows (migration 20260708120000), and
 * a filed chat may not be scoped directly at all. Writing `chats.access_mode`
 * from here would desync the folder from its contents — quietly, since the
 * write itself succeeds. The chats service owns those transitions. Throwing
 * beats the old behavior (a no-op UPDATE against the wrong table) and beats a
 * correct-looking write that breaks an invariant.
 */
export async function setResourceAccessModeRow(
  workspaceId: string,
  resourceType: TeamResourceType,
  resourceId: string,
  mode: AccessMode
): Promise<void> {
  if (resourceType === "chat" || resourceType === "chat_folder") {
    throw new Error(
      `setResourceAccessModeRow: ${resourceType} scope is owned by the chats service (folder scope propagates to its chats) — use it instead`
    );
  }
  const spec = RESOURCE_TABLES[resourceType];
  const db = supabaseAdmin();
  const { error } = await db
    .from(spec.table)
    .update({ access_mode: mode, updated_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("id", resourceId);
  if (error) throw error;
}
