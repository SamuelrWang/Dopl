import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { KnowledgeFolder } from "../types";
import {
  KNOWLEDGE_FOLDER_COLS,
  mapFolderRow,
  stripNulls,
  type KnowledgeFolderRow,
} from "./dto";

/**
 * Raw Supabase I/O for knowledge FOLDERS. No business logic, no auth checks —
 * see `repository.ts` for the split map and conventions.
 */

export async function findFolderById(
  id: string,
  includeDeleted = false
): Promise<KnowledgeFolder | null> {
  const db = supabaseAdmin();
  let query = db.from("knowledge_folders").select(KNOWLEDGE_FOLDER_COLS).eq("id", id);
  if (!includeDeleted) query = query.is("deleted_at", null);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data ? mapFolderRow(data as KnowledgeFolderRow) : null;
}

export async function listFoldersForBase(
  baseId: string,
  includeDeleted = false
): Promise<KnowledgeFolder[]> {
  const db = supabaseAdmin();
  let query = db
    .from("knowledge_folders")
    .select(KNOWLEDGE_FOLDER_COLS)
    .eq("knowledge_base_id", baseId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (!includeDeleted) query = query.is("deleted_at", null);
  const { data, error } = await query;
  if (error) throw error;
  return ((data ?? []) as KnowledgeFolderRow[]).map(mapFolderRow);
}

/** By (kb, parent, name). Unique partial index guarantees max-1 active row.
 *  Used by the path resolver. */
export async function findActiveFolderByName(
  baseId: string,
  parentId: string | null,
  name: string
): Promise<KnowledgeFolder | null> {
  const db = supabaseAdmin();
  let query = db
    .from("knowledge_folders")
    .select(KNOWLEDGE_FOLDER_COLS)
    .eq("knowledge_base_id", baseId)
    .eq("name", name)
    .is("deleted_at", null);
  if (parentId === null) query = query.is("parent_id", null);
  else query = query.eq("parent_id", parentId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data ? mapFolderRow(data as KnowledgeFolderRow) : null;
}

/**
 * `parent_id` chain from folder to root, index 0 = the folder itself. Feeds
 * `moveFolder`'s cycle pre-check and breadcrumbs.
 *
 * ⚠ INCLUDES soft-deleted nodes — a cycle through a trashed folder is still a
 * cycle once restored. Capped at 1000 hops, matching the DB trigger's guard.
 *
 * Iterative: N round trips. Trees are shallow (<10 levels); a recursive-CTE
 * RPC could replace this if depth ever matters.
 */
export async function listFolderAncestors(
  folderId: string
): Promise<KnowledgeFolder[]> {
  const chain: KnowledgeFolder[] = [];
  let cursor: string | null = folderId;
  let hops = 0;
  while (cursor !== null && hops < 1000) {
    const node = await findFolderById(cursor, true);
    if (!node) break;
    chain.push(node);
    cursor = node.parentId;
    hops += 1;
  }
  return chain;
}

/** Highest `position` among active folders in a (base, parent) bucket, -1 when
 *  empty. Sibling of `maxEntryPositionIn`; `insertFolder` appends at max + 1 so
 *  insertion order survives position-sorted views (F-8). */
export async function maxFolderPositionIn(
  baseId: string,
  parentId: string | null
): Promise<number> {
  const db = supabaseAdmin();
  let query = db
    .from("knowledge_folders")
    .select("position")
    .eq("knowledge_base_id", baseId)
    .is("deleted_at", null)
    .order("position", { ascending: false })
    .limit(1);
  if (parentId === null) query = query.is("parent_id", null);
  else query = query.eq("parent_id", parentId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data ? ((data as { position: number }).position ?? -1) : -1;
}

export interface InsertFolderArgs {
  workspaceId: string;
  knowledgeBaseId: string;
  parentId?: string | null;
  name: string;
  description?: string | null;
  position?: number;
  createdBy: string | null;
}

export async function insertFolder(
  args: InsertFolderArgs
): Promise<KnowledgeFolder> {
  const db = supabaseAdmin();
  // F-8: append after siblings when position unpinned (concurrency note on
  // maxEntryPositionIn).
  const position =
    args.position ??
    (await maxFolderPositionIn(args.knowledgeBaseId, args.parentId ?? null)) + 1;
  const { data, error } = await db
    .from("knowledge_folders")
    .insert({
      workspace_id: args.workspaceId,
      knowledge_base_id: args.knowledgeBaseId,
      parent_id: args.parentId ?? null,
      name: stripNulls(args.name),
      description: stripNulls(args.description ?? null),
      position,
      created_by: args.createdBy,
    })
    .select(KNOWLEDGE_FOLDER_COLS)
    .single();
  if (error || !data) throw error || new Error("Failed to insert knowledge folder");
  return mapFolderRow(data as KnowledgeFolderRow);
}

export interface UpdateFolderPatch {
  name?: string;
  description?: string | null;
  parentId?: string | null;
  position?: number;
}

export async function updateFolderRow(
  id: string,
  patch: UpdateFolderPatch
): Promise<KnowledgeFolder>;
export async function updateFolderRow(
  id: string,
  patch: UpdateFolderPatch,
  expectedUpdatedAt: string | undefined
): Promise<KnowledgeFolder | null>;
export async function updateFolderRow(
  id: string,
  patch: UpdateFolderPatch,
  expectedUpdatedAt?: string
): Promise<KnowledgeFolder | null> {
  const db = supabaseAdmin();
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = stripNulls(patch.name);
  if (patch.description !== undefined)
    update.description = stripNulls(patch.description);
  if (patch.parentId !== undefined) update.parent_id = patch.parentId;
  if (patch.position !== undefined) update.position = patch.position;
  // Optimistic-concurrency CAS (see updateBaseRow).
  let query = db.from("knowledge_folders").update(update).eq("id", id);
  if (expectedUpdatedAt !== undefined) {
    query = query.eq("updated_at", expectedUpdatedAt);
  }
  const { data, error } = await query.select(KNOWLEDGE_FOLDER_COLS).maybeSingle();
  if (error) throw error;
  if (!data) {
    if (expectedUpdatedAt !== undefined) return null;
    throw new Error("Failed to update knowledge folder");
  }
  return mapFolderRow(data as KnowledgeFolderRow);
}

/**
 * PERMANENTLY delete a folder, its descendant folders and every entry in the
 * subtree, in ONE atomic RPC. No trash.
 *
 * ⚠ MUST stay a single transaction. Split writes let an entries-delete commit
 * and a folder-delete fail, leaving an empty folder with its notes permanently
 * gone and nothing to recover them from.
 *
 * ⚠ ORDER IS LOAD-BEARING inside the function body: `knowledge_entries
 * .folder_id` is `ON DELETE SET NULL`, so deleting the folder first ORPHANS
 * its entries into the base root. The RPC deletes subtree ENTRIES first, then
 * the root folder — descendant folders cascade via the self-referential
 * `parent_id ... ON DELETE CASCADE`.
 */
export async function hardDeleteFolder(
  workspaceId: string,
  id: string
): Promise<void> {
  const db = supabaseAdmin();
  // ⚠ RPC from 20260807140000_cascade_hard_delete_folder_and_object.sql, not in
  // the generated Database types. DEPLOY-BLOCKING with that migration: this is
  // the ONLY folder delete path, so shipping without it fails every delete.
  const { error } = await db.rpc(
    "cascade_hard_delete_folder" as never,
    { p_workspace_id: workspaceId, p_folder_id: id } as never
  );
  if (error) throw error;
}
