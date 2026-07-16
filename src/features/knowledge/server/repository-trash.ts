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
 * Hard-delete trashed rows older than `iso` across ALL workspaces.
 * Used by the nightly cron in Item 5.C. Service-role only — bypasses
 * RLS, must be called from a privileged context.
 *
 * Returns counts per table for system_events logging.
 */
export async function hardDeleteOlderThanGlobal(
  iso: string
): Promise<{ entries: number; folders: number; bases: number }> {
  const db = supabaseAdmin();
  const entries = await db
    .from("knowledge_entries")
    .delete({ count: "exact" })
    .not("deleted_at", "is", null)
    .lt("deleted_at", iso);
  if (entries.error) throw entries.error;

  const folders = await db
    .from("knowledge_folders")
    .delete({ count: "exact" })
    .not("deleted_at", "is", null)
    .lt("deleted_at", iso);
  if (folders.error) throw folders.error;

  const bases = await db
    .from("knowledge_bases")
    .delete({ count: "exact" })
    .not("deleted_at", "is", null)
    .lt("deleted_at", iso);
  if (bases.error) throw bases.error;

  return {
    entries: entries.count ?? 0,
    folders: folders.count ?? 0,
    bases: bases.count ?? 0,
  };
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
