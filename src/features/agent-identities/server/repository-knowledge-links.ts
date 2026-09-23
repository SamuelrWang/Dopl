import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { readClient } from "@/shared/supabase/caller-client";
import { scopeKey } from "../lib/knowledge-scopes";
import type { IdentityKnowledgeScope } from "../types";

/**
 * Raw I/O for the KNOWLEDGE-BASE ATTACHMENTS on an agent identity — the third
 * section of `repository.ts`, lifted into a sibling when that file reached the
 * 500-line cap (F-562, 2026-09-02). `repository.ts` re-exports every name here,
 * so no caller moved; this is the move `knowledge/server/repository.ts` already
 * made, where the named file is a barrel over five.
 *
 * ⚠ **IT IS A SECTION, NOT A LAYER.** The same two-client rule `repository.ts`
 * states in its header holds unchanged: a read that answers *what may this
 * caller see* takes `readClient()`, a write stays on `supabaseAdmin()` until RLS
 * plan phase 4. Read that header before adding a function here.
 */

/**
 * ONE ATTACHMENT ROW, flat. ⚠ `scopeKind` decides which of the two id columns
 * is populated and the DB's `agent_identity_kb_scope_shape_check` guarantees
 * exactly one is — this shape is deliberately NOT the domain union
 * (`types.ts › IdentityKnowledgeScope`), because a row read back is evidence and
 * the narrowing belongs where the predicate runs, not in the mapper.
 */
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
      // ⚠ `?? EMPTY_X`-shaped defaulting, one layer down: a row written before
      // `20260930150000` and read through a stale PostgREST schema cache has no
      // `scope_kind`, and `undefined` reaching the union would take every
      // default branch silently. `'base'` is what such a row IS.
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
 * REPLACE-SET, same argument as `replaceTeamLinks`.
 *
 * ⚠ **SCOPED SINCE 2026-09-08**, and the DEDUPE key had to move with it: it used
 * to be the base id, which now collides across shapes — a whole-base scope and
 * a folder scope of that base are two different attachments that share it. The
 * key is the SHAPE plus its own id, which is exactly what the three partial
 * unique indexes in the migration enforce; keying on the base alone would have
 * dropped every folder but the first, silently.
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
 * EVERY LIVE FOLDER of a set of bases — the ancestor chain a path is derived
 * from, and the validation set a folder scope is checked against, in ONE query.
 *
 * ⚠ WHOLE BASES RATHER THAN THE NAMED FOLDER IDS, on purpose. A path is walked
 * up `parent_id` (`knowledge/server/path.ts`), so fetching only the folders
 * named would answer "what is this folder called" and never "where does it
 * live" — and fetching the ancestors one at a time is a query per level. The
 * folder count of a base is small and the read is bounded by the bases the
 * identity actually attaches.
 *
 * ⚠ SOFT-DELETED FOLDERS ARE EXCLUDED, which is what makes a trashed folder
 * disappear from the payload rather than render a path through a folder nobody
 * can open.
 */
export interface KnowledgeFolderRow {
  id: string;
  knowledgeBaseId: string;
  parentId: string | null;
  name: string;
  /**
   * `knowledge_folders.description` — the folder's own agent-facing summary,
   * added to this read on 2026-09-18 (A4) so the base CARD can carry a clause
   * per top-level folder without a second query.
   *
   * ⚠ **OPTIONAL FOR THE `scope_kind` REASON STATED ABOVE**, one layer up: a
   * response served through a stale PostgREST schema cache has no such key, and
   * a row type that swears it is present is the lie. Read it `?? null`.
   */
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

/** The named entries, live only. ⚠ BY ID rather than by base: an entry needs no
 *  siblings to be described, only its own folder, which the folder read above
 *  already carries. */
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

/**
 * The visibility facts needed to decide whether the CALLER may attach or see a
 * KB. ⚠ Read from `knowledge_bases` HERE rather than imported from
 * `features/knowledge`, mirroring `skills/server/repository.ts ›
 * listWorkspaceKnowledgeBases` — the same cross-feature-dependency argument.
 * The PREDICATE over these fields lives in `service-shared.ts › canSeeBaseRow`,
 * which is where the knowledge feature's `canSeeBase` rule is mirrored.
 * Soft-deleted bases are EXCLUDED: an attachment to a trashed base is an
 * attachment to nothing.
 */
export interface KnowledgeBaseAccessRow {
  id: string;
  name: string;
  visibility: "public" | "private";
  accessMode: "workspace" | "teams";
  createdBy: string | null;
  /**
   * ── THE CARD FACTS (2026-09-18, A4) ──────────────────────────────────────
   *
   * `slug` and `description`, read HERE rather than in a second query: this
   * row is already fetched for every attached base on every resolve, so the
   * base CARD's two cheapest facts cost nothing at all.
   *
   * ⚠ **OPTIONAL, AND NOT AS A HEDGE.** The predicate above
   * (`service-shared.ts › canSeeBaseRow`) is the row's REASON for existing and
   * neither key participates in it, so every existing caller and every test
   * fixture constructs this row without them. Read `?? ""` / `?? null`.
   */
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

/**
 * Teams granted on a set of knowledge bases. ⚠ THIS ONE READS ANOTHER FEATURE'S
 * SLICE of `resource_grants`, because mirroring the knowledge access predicate
 * means reading the rows that predicate reads. It is a READ of a fixed
 * `resource_type`, and this file never writes there.
 *
 * ⚠ The two lanes now share ONE TABLE (`20260914120000`) where they used to
 * share only a shape, so the `resource_type` term stopped being a narrowing and
 * became the fence: without it this would answer "which teams reach this KB"
 * with the identity links three functions above.
 */
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
