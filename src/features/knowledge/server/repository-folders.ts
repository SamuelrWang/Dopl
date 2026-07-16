import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { KnowledgeFolder } from "../types";
import {
  KNOWLEDGE_FOLDER_COLS,
  mapFolderRow,
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
  const { data, error } = await db
    .from("knowledge_folders")
    .insert({
      workspace_id: args.workspaceId,
      knowledge_base_id: args.knowledgeBaseId,
      parent_id: args.parentId ?? null,
      name: args.name,
      description: args.description ?? null,
      position: args.position ?? 0,
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
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.description !== undefined) update.description = patch.description;
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
 * Soft-delete a folder AND every active descendant (folders + entries)
 * via the recursive-CTE cascade RPC. Atomic. See markBaseDeleted for
 * the same-timestamp + restore semantics.
 */
export async function markFolderDeleted(
  id: string,
  deletedAt: string = new Date().toISOString()
): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db.rpc("cascade_soft_delete_folder", {
    p_folder_id: id,
    p_deleted_at: deletedAt,
  });
  if (error) throw error;
}

/**
 * Restore a folder + every descendant whose `deleted_at` matches.
 * Independently-trashed descendants stay in trash.
 */
export async function restoreFolderRow(id: string): Promise<KnowledgeFolder> {
  const db = supabaseAdmin();
  const { error } = await db.rpc("cascade_restore_folder", {
    p_folder_id: id,
  });
  if (error) throw error;
  const restored = await findFolderById(id, false);
  if (!restored) throw new Error("Failed to restore knowledge folder");
  return restored;
}
