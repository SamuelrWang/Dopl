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
 * Raw Supabase I/O for knowledge FOLDERS — reads, ancestor walk, writes,
 * and cascade trash/restore. No business logic, no auth checks; see
 * `repository.ts` for the split map and conventions.
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

/**
 * Find a folder by (kb, parent, name) — the unique partial index from
 * Item 4 makes this a max-1-row query among active rows. Used by the
 * path resolver.
 */
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
 * Walks `parent_id` from the given folder up to the root. Used by the
 * service's cycle pre-check on `moveFolder` and to build breadcrumbs.
 *
 * Returns the chain ordered from the given folder up to the root
 * (index 0 is the folder itself).
 *
 * Includes soft-deleted nodes — a cycle that runs through a trashed
 * folder is still a cycle and would still cause infinite recursion if
 * the trashed folder were ever restored. Capped at 1000 hops as a
 * safety net (matches the DB trigger's guard).
 *
 * Iterative walk — N round-trips. Folder trees are typically shallow
 * (<10 levels), so the cost is negligible. A recursive-CTE RPC could
 * replace this for deep trees if it ever matters.
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

/**
 * Highest `position` among active folders in a (base, parent) bucket, or
 * -1 when the bucket is empty. Sibling to `maxEntryPositionIn` — lets
 * `insertFolder` append with `max + 1` so folders created in sequence keep
 * their insertion order in position-sorted views instead of all landing at
 * 0 (F-8).
 */
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
  // F-8: append after existing siblings when no explicit position was
  // given (see maxEntryPositionIn for the concurrency note).
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
  // Optimistic concurrency CAS (see updateBaseRow).
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
 * PERMANENTLY delete a folder, every descendant folder, and every entry
 * in that subtree, in ONE atomic RPC. Deletion is immediate and
 * irreversible — there is no trash (2026-08-07).
 *
 * WHY AN RPC. This was N SELECTs to walk the tree plus TWO independent
 * DELETEs. Nothing bound those two writes, so an entries-delete that
 * committed followed by a folder-delete that failed left the folder alive
 * and empty with its notes permanently gone — and with trash removed there
 * is nothing to recover them from. That is verbatim the failure the
 * ontology cluster RPC was written to close ("One function body = both
 * DELETEs commit or neither", 20260807120000). The same argument applies
 * here, so the same shape does: one transaction, one round trip.
 *
 * THE ORDER SURVIVES INTO THE FUNCTION BODY. `knowledge_entries.folder_id`
 * is `ON DELETE SET NULL`, so deleting the folder first would ORPHAN its
 * entries into the base root instead of removing them; the RPC deletes the
 * subtree's entries FIRST, then the root folder — whose descendant
 * *folders* cascade out via the self-referential `parent_id ... ON DELETE
 * CASCADE` FK. The recursive CTE inside replaces the breadth-first walk
 * that used to live here.
 */
export async function hardDeleteFolder(
  workspaceId: string,
  id: string
): Promise<void> {
  const db = supabaseAdmin();
  // RPC added by migration 20260807140000_cascade_hard_delete_folder_and_object.sql;
  // not yet in the generated Database types (regenerated after the migration
  // applies). DEPLOY-BLOCKING with that migration — this is the only folder
  // delete path, so shipping without it fails every folder delete at runtime.
  const { error } = await db.rpc(
    "cascade_hard_delete_folder" as never,
    { p_workspace_id: workspaceId, p_folder_id: id } as never
  );
  if (error) throw error;
}
