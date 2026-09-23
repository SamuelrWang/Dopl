import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { readClient } from "@/shared/supabase/caller-client";
import { scopeKey } from "../lib/knowledge-scopes";
import type { IdentityKnowledgeScope } from "../types";

/**
 * Raw I/O for an identity's knowledge attachments, re-exported by `repository.ts` (same two-client
 * rule). The `deleted_at IS NULL` filters are inert — knowledge has no soft delete since
 * `20261013120000` — and leave with the columns (F-730).
 */

/** One attachment row, flat; the service narrows it to the domain union. */
export interface IdentityKnowledgeLinkRow {
  identityId: string;
  knowledgeBaseId: string;
  scopeKind: "base" | "folder" | "entry";
  folderId: string | null;
  entryId: string | null;
}

export async function listKnowledgeLinksForIdentities(
  workspaceId: string,
  identityIds: string[]
): Promise<IdentityKnowledgeLinkRow[]> {
  if (identityIds.length === 0) return [];
  const db = readClient();
  const { data, error } = await db
    .from("agent_identity_knowledge_bases")
    .select("identity_id, knowledge_base_id, scope_kind, folder_id, entry_id")
    .eq("workspace_id", workspaceId)
    .in("identity_id", identityIds);
  if (error) throw error;
  return (
    (data ?? []) as Array<{
      identity_id: string;
      knowledge_base_id: string;
      // A stale PostgREST schema cache omits `scope_kind`; such a row is a base scope.
      scope_kind?: string | null;
      folder_id?: string | null;
      entry_id?: string | null;
    }>
  ).map((r) => ({
    identityId: r.identity_id,
    knowledgeBaseId: r.knowledge_base_id,
    scopeKind:
      r.scope_kind === "folder" || r.scope_kind === "entry"
        ? r.scope_kind
        : ("base" as const),
    folderId: r.folder_id ?? null,
    entryId: r.entry_id ?? null,
  }));
}

/**
 * Replace-set. The dedupe key is shape + its own id (the three partial unique indexes), never the
 * base id — a base scope and a folder scope of that base are different attachments.
 */
export async function replaceKnowledgeLinks(
  workspaceId: string,
  identityId: string,
  scopes: ReadonlyArray<IdentityKnowledgeScope>,
  addedBy: string | null
): Promise<void> {
  const db = supabaseAdmin();
  const del = await db
    .from("agent_identity_knowledge_bases")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("identity_id", identityId);
  if (del.error) throw del.error;
  if (scopes.length === 0) return;
  const seen = new Set<string>();
  const rows: Array<Record<string, string | null>> = [];
  for (const scope of scopes) {
    const key = scopeKey(scope);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      identity_id: identityId,
      knowledge_base_id: scope.baseId,
      workspace_id: workspaceId,
      added_by_user_id: addedBy,
      scope_kind: scope.scope,
      folder_id: scope.scope === "folder" ? scope.folderId : null,
      entry_id: scope.scope === "entry" ? scope.entryId : null,
    });
  }
  const { error } = await db
    .from("agent_identity_knowledge_bases")
    .insert(rows);
  if (error) throw error;
}

/**
 * Every folder of a set of bases in one query — whole bases, because a path is walked up
 * `parent_id` and per-ancestor reads would be a query per level.
 */
export interface KnowledgeFolderRow {
  id: string;
  knowledgeBaseId: string;
  parentId: string | null;
  name: string;
  /** The folder's agent-facing summary (base card). Optional: a stale schema cache omits it. */
  description?: string | null;
}

export async function listLiveFoldersForBases(
  workspaceId: string,
  baseIds: string[]
): Promise<KnowledgeFolderRow[]> {
  if (baseIds.length === 0) return [];
  const db = readClient();
  const { data, error } = await db
    .from("knowledge_folders")
    .select("id, knowledge_base_id, parent_id, name, description")
    .eq("workspace_id", workspaceId)
    .in("knowledge_base_id", baseIds)
    .is("deleted_at", null);
  if (error) throw error;
  return (
    (data ?? []) as Array<{
      id: string;
      knowledge_base_id: string;
      parent_id: string | null;
      name: string;
      description?: string | null;
    }>
  ).map((r) => ({
    id: r.id,
    knowledgeBaseId: r.knowledge_base_id,
    parentId: r.parent_id,
    name: r.name,
    description: r.description ?? null,
  }));
}

/** The named entries, by id (an entry needs only its own folder, which the folder read carries). */
export interface KnowledgeEntryRow {
  id: string;
  knowledgeBaseId: string;
  folderId: string | null;
  title: string;
}

export async function listLiveEntryRows(
  workspaceId: string,
  entryIds: string[]
): Promise<KnowledgeEntryRow[]> {
  if (entryIds.length === 0) return [];
  const db = readClient();
  const { data, error } = await db
    .from("knowledge_entries")
    .select("id, knowledge_base_id, folder_id, title")
    .eq("workspace_id", workspaceId)
    .in("id", entryIds)
    .is("deleted_at", null);
  if (error) throw error;
  return (
    (data ?? []) as Array<{
      id: string;
      knowledge_base_id: string;
      folder_id: string | null;
      title: string;
    }>
  ).map((r) => ({
    id: r.id,
    knowledgeBaseId: r.knowledge_base_id,
    folderId: r.folder_id,
    title: r.title,
  }));
}

/** The facts `service-shared.ts › canSeeBaseRow` judges, read here rather than imported (§1). */
export interface KnowledgeBaseAccessRow {
  id: string;
  name: string;
  visibility: "public" | "private";
  accessMode: "workspace" | "teams";
  createdBy: string | null;
  /** Base-card facts riding the access read; optional (the predicate ignores them). */
  slug?: string;
  description?: string | null;
}

export async function listKnowledgeBaseAccessRows(
  workspaceId: string,
  ids: string[]
): Promise<KnowledgeBaseAccessRow[]> {
  if (ids.length === 0) return [];
  const db = readClient();
  const { data, error } = await db
    .from("knowledge_bases")
    .select("id, name, visibility, access_mode, created_by, slug, description")
    .eq("workspace_id", workspaceId)
    .in("id", ids)
    .is("deleted_at", null);
  if (error) throw error;
  return (
    (data ?? []) as Array<{
      id: string;
      name: string;
      visibility: "public" | "private";
      access_mode: "workspace" | "teams";
      created_by: string | null;
      slug?: string | null;
      description?: string | null;
    }>
  ).map((r) => ({
    id: r.id,
    name: r.name,
    visibility: r.visibility,
    accessMode: r.access_mode,
    createdBy: r.created_by,
    slug: r.slug ?? "",
    description: r.description ?? null,
  }));
}

/** Teams granted on a set of knowledge bases — the knowledge slice of `resource_grants` (read only). */
export async function listKnowledgeBaseTeamGrants(
  workspaceId: string,
  knowledgeBaseIds: string[]
): Promise<Array<{ knowledgeBaseId: string; teamId: string }>> {
  if (knowledgeBaseIds.length === 0) return [];
  const db = readClient();
  const { data, error } = await db
    .from("resource_grants")
    .select("resource_id, scope_id")
    .match({
      workspace_id: workspaceId,
      scope_type: "team",
      resource_type: "knowledge_base",
    })
    .in("resource_id", knowledgeBaseIds);
  if (error) throw error;
  return (
    (data ?? []) as Array<{ resource_id: string; scope_id: string }>
  ).map((r) => ({ knowledgeBaseId: r.resource_id, teamId: r.scope_id }));
}
