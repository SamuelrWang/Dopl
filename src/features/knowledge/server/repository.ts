import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type {
  KnowledgeBase,
  KnowledgeFolder,
  KnowledgeEntry,
  KnowledgeEntryType,
  WriteSource,
} from "../types";
import {
  KNOWLEDGE_BASE_COLS,
  KNOWLEDGE_FOLDER_COLS,
  KNOWLEDGE_ENTRY_COLS,
  KNOWLEDGE_ENTRY_META_COLS,
  mapBaseRow,
  mapFolderRow,
  mapEntryRow,
  type KnowledgeBaseRow,
  type KnowledgeFolderRow,
  type KnowledgeEntryRow,
  type KnowledgeEntryMetaRow,
} from "./dto";

/**
 * Raw Supabase I/O for the knowledge feature. No business logic, no
 * auth checks, no error translation — that all lives in `service.ts`.
 *
 * Convention:
 *   - `find*` returns `T | null` for "not found".
 *   - `list*` returns `T[]` (possibly empty).
 *   - `insert*` / `update*` / `mark*Deleted` / `restore*` throw on error.
 *   - Active vs trashed: every list/find takes `includeDeleted`. Default
 *     `false` (active rows only). Trash views pass `true` and filter
 *     `deletedAt !== null` themselves; restore paths pass `true` so they
 *     can read deleted rows.
 *   - Service-role client bypasses RLS; the service is responsible for
 *     workspace scoping. Every method that takes a `workspaceId` param
 *     filters by it explicitly so RLS bypass is contained.
 */

// ─── Bases ──────────────────────────────────────────────────────────

export async function findBaseById(
  id: string,
  includeDeleted = false
): Promise<KnowledgeBase | null> {
  const db = supabaseAdmin();
  let query = db.from("knowledge_bases").select(KNOWLEDGE_BASE_COLS).eq("id", id);
  if (!includeDeleted) query = query.is("deleted_at", null);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data ? mapBaseRow(data as KnowledgeBaseRow) : null;
}

export async function findBaseBySlug(
  workspaceId: string,
  slug: string,
  includeDeleted = false
): Promise<KnowledgeBase | null> {
  const db = supabaseAdmin();
  let query = db
    .from("knowledge_bases")
    .select(KNOWLEDGE_BASE_COLS)
    .eq("workspace_id", workspaceId)
    .eq("slug", slug);
  if (!includeDeleted) query = query.is("deleted_at", null);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data ? mapBaseRow(data as KnowledgeBaseRow) : null;
}

export async function listBasesForWorkspace(
  workspaceId: string,
  includeDeleted = false
): Promise<KnowledgeBase[]> {
  const db = supabaseAdmin();
  let query = db
    .from("knowledge_bases")
    .select(KNOWLEDGE_BASE_COLS)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });
  if (!includeDeleted) query = query.is("deleted_at", null);
  const { data, error } = await query;
  if (error) throw error;
  return ((data ?? []) as KnowledgeBaseRow[]).map(mapBaseRow);
}

/**
 * Read-only — used by slug-collision checks in the service. Returns
 * both active and deleted slugs so a freshly-deleted slug can't be
 * recycled until the trash row is purged.
 */
export async function listBaseSlugsForWorkspace(
  workspaceId: string
): Promise<string[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("knowledge_bases")
    .select("slug")
    .eq("workspace_id", workspaceId);
  if (error) throw error;
  return ((data ?? []) as Array<{ slug: string }>).map((r) => r.slug);
}

export interface InsertBaseArgs {
  workspaceId: string;
  name: string;
  slug: string;
  description?: string | null;
  agentWriteEnabled?: boolean;
  createdBy: string | null;
}

export async function insertBase(args: InsertBaseArgs): Promise<KnowledgeBase> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("knowledge_bases")
    .insert({
      workspace_id: args.workspaceId,
      name: args.name,
      slug: args.slug,
      description: args.description ?? null,
      agent_write_enabled: args.agentWriteEnabled ?? false,
      created_by: args.createdBy,
    })
    .select(KNOWLEDGE_BASE_COLS)
    .single();
  if (error || !data) throw error || new Error("Failed to insert knowledge base");
  return mapBaseRow(data as KnowledgeBaseRow);
}

export interface UpdateBasePatch {
  name?: string;
  slug?: string;
  description?: string | null;
  agentWriteEnabled?: boolean;
}

export async function updateBaseRow(
  id: string,
  patch: UpdateBasePatch
): Promise<KnowledgeBase> {
  const db = supabaseAdmin();
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.slug !== undefined) update.slug = patch.slug;
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.agentWriteEnabled !== undefined)
    update.agent_write_enabled = patch.agentWriteEnabled;
  const { data, error } = await db
    .from("knowledge_bases")
    .update(update)
    .eq("id", id)
    .select(KNOWLEDGE_BASE_COLS)
    .single();
  if (error || !data) throw error || new Error("Failed to update knowledge base");
  return mapBaseRow(data as KnowledgeBaseRow);
}

/**
 * Soft-delete a base AND every active folder/entry inside it. The
 * cascade is atomic — one PL/pgSQL function call. Already-trashed rows
 * keep their original timestamp so an independent prior trash event
 * survives a later ancestor restore.
 */
export async function markBaseDeleted(
  id: string,
  deletedAt: string = new Date().toISOString()
): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db.rpc("cascade_soft_delete_base", {
    p_base_id: id,
    p_deleted_at: deletedAt,
  });
  if (error) throw error;
}

/**
 * Restore a base + every descendant whose `deleted_at` matches the base's
 * (i.e. was cascaded by the same trash event). Independently-trashed
 * descendants keep their own timestamp and stay in trash.
 */
export async function restoreBaseRow(id: string): Promise<KnowledgeBase> {
  const db = supabaseAdmin();
  const { error } = await db.rpc("cascade_restore_base", { p_base_id: id });
  if (error) throw error;
  const restored = await findBaseById(id, false);
  if (!restored) throw new Error("Failed to restore knowledge base");
  return restored;
}

// ─── Folders ────────────────────────────────────────────────────────

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
  parentId?: string | null;
  position?: number;
}

export async function updateFolderRow(
  id: string,
  patch: UpdateFolderPatch
): Promise<KnowledgeFolder> {
  const db = supabaseAdmin();
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.parentId !== undefined) update.parent_id = patch.parentId;
  if (patch.position !== undefined) update.position = patch.position;
  const { data, error } = await db
    .from("knowledge_folders")
    .update(update)
    .eq("id", id)
    .select(KNOWLEDGE_FOLDER_COLS)
    .single();
  if (error || !data) throw error || new Error("Failed to update knowledge folder");
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

// ─── Entries ────────────────────────────────────────────────────────

export interface ListEntriesOpts {
  /** When provided, only entries directly under this folder. NULL = base root. */
  folderId?: string | null;
  /** Default true. Set false to skip the heavy `body` column. */
  includeBody?: boolean;
  includeDeleted?: boolean;
}

export async function findEntryById(
  id: string,
  includeDeleted = false
): Promise<KnowledgeEntry | null> {
  const db = supabaseAdmin();
  let query = db.from("knowledge_entries").select(KNOWLEDGE_ENTRY_COLS).eq("id", id);
  if (!includeDeleted) query = query.is("deleted_at", null);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data ? mapEntryRow(data as KnowledgeEntryRow) : null;
}

/**
 * Find an entry by (kb, folder, title) — like `findActiveFolderByName`,
 * the unique partial index from Item 4 guarantees max-1 row among
 * active entries. Used by the path resolver.
 */
export async function findActiveEntryByTitle(
  baseId: string,
  folderId: string | null,
  title: string
): Promise<KnowledgeEntry | null> {
  const db = supabaseAdmin();
  let query = db
    .from("knowledge_entries")
    .select(KNOWLEDGE_ENTRY_COLS)
    .eq("knowledge_base_id", baseId)
    .eq("title", title)
    .is("deleted_at", null);
  if (folderId === null) query = query.is("folder_id", null);
  else query = query.eq("folder_id", folderId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data ? mapEntryRow(data as KnowledgeEntryRow) : null;
}

export async function listEntriesForBase(
  baseId: string,
  opts: ListEntriesOpts = {}
): Promise<KnowledgeEntry[]> {
  const includeBody = opts.includeBody ?? true;
  const includeDeleted = opts.includeDeleted ?? false;
  const db = supabaseAdmin();
  let query = db
    .from("knowledge_entries")
    .select(includeBody ? KNOWLEDGE_ENTRY_COLS : KNOWLEDGE_ENTRY_META_COLS)
    .eq("knowledge_base_id", baseId);
  if (opts.folderId !== undefined) {
    if (opts.folderId === null) {
      query = query.is("folder_id", null);
    } else {
      query = query.eq("folder_id", opts.folderId);
    }
  }
  if (!includeDeleted) query = query.is("deleted_at", null);
  query = query
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  const { data, error } = await query;
  if (error) throw error;
  if (includeBody) {
    return ((data ?? []) as unknown as KnowledgeEntryRow[]).map(mapEntryRow);
  }
  return ((data ?? []) as unknown as KnowledgeEntryMetaRow[]).map((row) =>
    mapEntryRow({ ...row, body: "" })
  );
}

export async function listEntriesForFolder(
  folderId: string | null,
  baseId: string,
  opts: Omit<ListEntriesOpts, "folderId"> = {}
): Promise<KnowledgeEntry[]> {
  return listEntriesForBase(baseId, { ...opts, folderId });
}

export interface InsertEntryArgs {
  workspaceId: string;
  knowledgeBaseId: string;
  folderId?: string | null;
  title: string;
  excerpt?: string | null;
  body?: string;
  entryType?: KnowledgeEntryType;
  position?: number;
  createdBy: string | null;
  source: WriteSource;
}

export async function insertEntry(
  args: InsertEntryArgs
): Promise<KnowledgeEntry> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("knowledge_entries")
    .insert({
      workspace_id: args.workspaceId,
      knowledge_base_id: args.knowledgeBaseId,
      folder_id: args.folderId ?? null,
      title: args.title,
      excerpt: args.excerpt ?? null,
      body: args.body ?? "",
      entry_type: args.entryType ?? "note",
      position: args.position ?? 0,
      created_by: args.createdBy,
      last_edited_by: args.createdBy,
      last_edited_source: args.source,
    })
    .select(KNOWLEDGE_ENTRY_COLS)
    .single();
  if (error || !data) throw error || new Error("Failed to insert knowledge entry");
  return mapEntryRow(data as KnowledgeEntryRow);
}

export interface UpdateEntryPatch {
  title?: string;
  excerpt?: string | null;
  body?: string;
  entryType?: KnowledgeEntryType;
  folderId?: string | null;
  position?: number;
  /** Caller's identity — written to last_edited_by. */
  lastEditedBy?: string | null;
  /** Caller's source — written to last_edited_source. */
  lastEditedSource?: WriteSource;
}

export async function updateEntryRow(
  id: string,
  patch: UpdateEntryPatch
): Promise<KnowledgeEntry> {
  const db = supabaseAdmin();
  const update: Record<string, unknown> = {};
  if (patch.title !== undefined) update.title = patch.title;
  if (patch.excerpt !== undefined) update.excerpt = patch.excerpt;
  if (patch.body !== undefined) update.body = patch.body;
  if (patch.entryType !== undefined) update.entry_type = patch.entryType;
  if (patch.folderId !== undefined) update.folder_id = patch.folderId;
  if (patch.position !== undefined) update.position = patch.position;
  if (patch.lastEditedBy !== undefined) update.last_edited_by = patch.lastEditedBy;
  if (patch.lastEditedSource !== undefined)
    update.last_edited_source = patch.lastEditedSource;
  const { data, error } = await db
    .from("knowledge_entries")
    .update(update)
    .eq("id", id)
    .select(KNOWLEDGE_ENTRY_COLS)
    .single();
  if (error || !data) throw error || new Error("Failed to update knowledge entry");
  return mapEntryRow(data as KnowledgeEntryRow);
}

export async function markEntryDeleted(
  id: string,
  deletedAt: string = new Date().toISOString()
): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db
    .from("knowledge_entries")
    .update({ deleted_at: deletedAt })
    .eq("id", id);
  if (error) throw error;
}

export async function restoreEntryRow(id: string): Promise<KnowledgeEntry> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("knowledge_entries")
    .update({ deleted_at: null })
    .eq("id", id)
    .select(KNOWLEDGE_ENTRY_COLS)
    .single();
  if (error || !data) throw error || new Error("Failed to restore knowledge entry");
  return mapEntryRow(data as KnowledgeEntryRow);
}

// ─── Trash ──────────────────────────────────────────────────────────

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
