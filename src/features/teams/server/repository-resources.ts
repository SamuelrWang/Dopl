import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { AccessMode, TeamResourceType } from "../access-levels";

/**
 * The grantable resources themselves — the only part of the teams repository
 * that touches another feature's table. A grant row says WHICH resource;
 * this file knows where it lives, its name column and its creator column.
 * `repository-grants.ts` owns the rows pointing here.
 * ⚠ Raw Supabase I/O: every query filtered by `workspace_id`.
 */

export interface TeamsModeResourceRow {
  resourceType: TeamResourceType;
  resourceId: string;
  createdBy: string | null;
}

/** Every teams-mode resource in the workspace (live KBs + skills). */
export async function listTeamsModeResources(
  workspaceId: string
): Promise<TeamsModeResourceRow[]> {
  const db = supabaseAdmin();
  const [kbs, skills] = await Promise.all([
    db
      .from("knowledge_bases")
      .select("id, created_by")
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
  if (skills.error) throw skills.error;
  return [
    ...((kbs.data ?? []) as Array<{ id: string; created_by: string | null }>).map(
      (r) => ({
        resourceType: "knowledge_base" as const,
        resourceId: r.id,
        createdBy: r.created_by,
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

export interface ResourceAccessMeta {
  name: string;
  accessMode: AccessMode;
  createdBy: string | null;
}

/**
 * Where each grantable resource type lives.
 * `team_resource_access.resource_id` is polymorphic across FOUR tables, each
 * spelling "name" and "creator" differently.
 * ⚠ `satisfies Record<TeamResourceType, …>` is load-bearing: a fifth resource
 * type must fail to compile here rather than resolve to the wrong table. A
 * Supabase `.update()` matching zero rows returns `{ error: null }`, so a
 * mis-routed write "succeeds" silently and reverts on the next refetch.
 */
const RESOURCE_TABLES = {
  knowledge_base: { table: "knowledge_bases", nameCol: "name", creatorCol: "created_by" },
  skill: { table: "skills", nameCol: "name", creatorCol: "created_by" },
  chat: { table: "chats", nameCol: "title", creatorCol: "owner_id" },
  chat_folder: { table: "chat_folders", nameCol: "name", creatorCol: "user_id" },
} satisfies Record<
  TeamResourceType,
  { table: string; nameCol: string; creatorCol: string }
>;

/** access_mode + creator + name for one resource; null if missing.
 *  ⚠ Soft-deleted KBs INCLUDED on purpose — access checks must resolve for
 *  trash restore; read gating happens in the knowledge service's lookups. */
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
  // Double cast: template-literal projection yields a ParserError from
  // supabase-js's select-string parser. Columns come from RESOURCE_TABLES.
  const row = data as unknown as Record<string, unknown>;
  return {
    name: row[spec.nameCol] as string,
    accessMode: row.access_mode as AccessMode,
    createdBy: (row[spec.creatorCol] as string | null) ?? null,
  };
}

/**
 * Flip one resource row between `workspace` and `teams` scope.
 * ⚠ CHATS AND CHAT FOLDERS ARE REFUSED, not routed: a folder's scope is
 * authoritative for every chat filed in it and PROPAGATES to those rows, and
 * a filed chat may not be scoped directly. Writing `chats.access_mode` here
 * would desync folder from contents — silently, since the write succeeds.
 * The chats service owns those transitions.
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
