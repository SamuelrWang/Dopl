import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type {
  KnowledgeBase,
  KnowledgeFolder,
  KnowledgeEntry,
} from "../types";
import {
  KNOWLEDGE_BASE_COLS,
  KNOWLEDGE_FOLDER_COLS,
  KNOWLEDGE_ENTRY_META_COLS,
  mapBaseRow,
  mapFolderRow,
  mapEntryRow,
  type KnowledgeBaseRow,
  type KnowledgeFolderRow,
  type KnowledgeEntryMetaRow,
} from "./dto";

/**
 * Raw Supabase I/O for the knowledge TRASH view + hard-delete (purge)
 * paths. No business logic, no auth checks; see `repository.ts` for the
 * split map and conventions.
 */

export interface DeletedRows {
  bases: KnowledgeBase[];
  folders: KnowledgeFolder[];
  entries: KnowledgeEntry[];
}

/**
 * Returns every soft-deleted row in the workspace (or scoped to a
 * specific base if `baseId` is provided). Service exposes this as the
 * trash view.
 */
export async function listDeletedForWorkspace(
  workspaceId: string,
  baseId?: string
): Promise<DeletedRows> {
  const db = supabaseAdmin();

  let basesQuery = db
    .from("knowledge_bases")
    .select(KNOWLEDGE_BASE_COLS)
    .eq("workspace_id", workspaceId)
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });
  if (baseId) basesQuery = basesQuery.eq("id", baseId);

  let foldersQuery = db
    .from("knowledge_folders")
    .select(KNOWLEDGE_FOLDER_COLS)
    .eq("workspace_id", workspaceId)
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });
  if (baseId) foldersQuery = foldersQuery.eq("knowledge_base_id", baseId);

  let entriesQuery = db
    .from("knowledge_entries")
    .select(KNOWLEDGE_ENTRY_META_COLS)
    .eq("workspace_id", workspaceId)
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });
  if (baseId) entriesQuery = entriesQuery.eq("knowledge_base_id", baseId);

  const [basesRes, foldersRes, entriesRes] = await Promise.all([
    basesQuery,
    foldersQuery,
    entriesQuery,
  ]);
  if (basesRes.error) throw basesRes.error;
  if (foldersRes.error) throw foldersRes.error;
  if (entriesRes.error) throw entriesRes.error;

  return {
    bases: ((basesRes.data ?? []) as KnowledgeBaseRow[]).map(mapBaseRow),
    folders: ((foldersRes.data ?? []) as KnowledgeFolderRow[]).map(mapFolderRow),
    entries: ((entriesRes.data ?? []) as KnowledgeEntryMetaRow[]).map((row) =>
      mapEntryRow({ ...row, body: "" })
    ),
  };
}

/**
 * Permanently hard-delete a single trashed BASE. Workspace-scoped and
 * gated on `deleted_at IS NOT NULL` so a live base can never be purged.
 * The base's folders/entries (and embeddings/cluster links) cascade via
 * their `knowledge_base_id ... ON DELETE CASCADE` FKs.
 */
export async function purgeBaseRow(
  workspaceId: string,
  id: string
): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db
    .from("knowledge_bases")
    .delete()
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .not("deleted_at", "is", null);
  if (error) throw error;
}

/**
 * Permanently hard-delete a single trashed FOLDER and its trashed
 * descendant entries.
 *
 * `knowledge_entries.folder_id` is `ON DELETE SET NULL`, so deleting the
 * folder alone would orphan its entries (folder_id nulled, rows left in
 * trash) instead of removing them. To match the soft-delete cascade
 * semantics we hard-delete every trashed entry under the folder subtree
 * FIRST, then delete the root folder — whose descendant *folders* cascade
 * out via the self-referential `parent_id ... ON DELETE CASCADE` FK.
 *
 * Invariant relied on: a trashed folder's descendants are all trashed too
 * (soft-delete cascades down; restore refuses while an ancestor is
 * trashed), so the `deleted_at IS NOT NULL` filter on the entry delete is
 * safe and never removes a live row.
 */
export async function purgeFolderRow(
  workspaceId: string,
  id: string
): Promise<void> {
  const db = supabaseAdmin();
  const subtreeIds = await collectFolderSubtreeIds(workspaceId, id);
  const entriesRes = await db
    .from("knowledge_entries")
    .delete()
    .eq("workspace_id", workspaceId)
    .in("folder_id", subtreeIds)
    .not("deleted_at", "is", null);
  if (entriesRes.error) throw entriesRes.error;

  const folderRes = await db
    .from("knowledge_folders")
    .delete()
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .not("deleted_at", "is", null);
  if (folderRes.error) throw folderRes.error;
}

/**
 * Permanently hard-delete a single trashed ENTRY. Workspace-scoped and
 * gated on `deleted_at IS NOT NULL`.
 */
export async function purgeEntryRow(
  workspaceId: string,
  id: string
): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db
    .from("knowledge_entries")
    .delete()
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .not("deleted_at", "is", null);
  if (error) throw error;
}

/**
 * Breadth-first walk of `parent_id` gathering the folder id plus every
 * descendant folder id, workspace-scoped. Used by `purgeFolderRow` to
 * find the entries that would otherwise be SET-NULL-orphaned. Folder
 * trees are shallow, so the per-level round-trips are cheap.
 */
async function collectFolderSubtreeIds(
  workspaceId: string,
  rootId: string
): Promise<string[]> {
  const db = supabaseAdmin();
  const ids = [rootId];
  let frontier = [rootId];
  while (frontier.length > 0) {
    const { data, error } = await db
      .from("knowledge_folders")
      .select("id")
      .eq("workspace_id", workspaceId)
      .in("parent_id", frontier);
    if (error) throw error;
    const next = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
    if (next.length === 0) break;
    ids.push(...next);
    frontier = next;
  }
  return ids;
}

/**
 * Hard-delete trashed rows older than `iso` for a single workspace.
 * Service exposes this as `purgeTrashOlderThan` for the future cron.
 * Returns the number of rows deleted across all three tables.
 */
export async function hardDeleteOlderThan(
  workspaceId: string,
  iso: string
): Promise<{ deleted: number }> {
  const db = supabaseAdmin();
  // Order matters: entries → folders → bases. Cascade FKs would catch
  // orphans either way, but doing it explicitly avoids deleting a base
  // before its entries get a separate audit trail.
  const entries = await db
    .from("knowledge_entries")
    .delete({ count: "exact" })
    .eq("workspace_id", workspaceId)
    .not("deleted_at", "is", null)
    .lt("deleted_at", iso);
  if (entries.error) throw entries.error;

  const folders = await db
    .from("knowledge_folders")
    .delete({ count: "exact" })
    .eq("workspace_id", workspaceId)
    .not("deleted_at", "is", null)
    .lt("deleted_at", iso);
  if (folders.error) throw folders.error;

  const bases = await db
    .from("knowledge_bases")
    .delete({ count: "exact" })
    .eq("workspace_id", workspaceId)
    .not("deleted_at", "is", null)
    .lt("deleted_at", iso);
  if (bases.error) throw bases.error;

  return {
    deleted: (entries.count ?? 0) + (folders.count ?? 0) + (bases.count ?? 0),
  };
}
