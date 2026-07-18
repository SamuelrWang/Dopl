import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type {
  KnowledgeEntry,
  KnowledgeEntryType,
  WriteSource,
} from "../types";
import {
  KNOWLEDGE_ENTRY_COLS,
  KNOWLEDGE_ENTRY_META_COLS,
  mapEntryRow,
  stripNulls,
  type KnowledgeEntryRow,
  type KnowledgeEntryMetaRow,
} from "./dto";

/**
 * Raw Supabase I/O for knowledge ENTRIES — reads (incl. path-resolver
 * helpers and batch id lookups), writes, and soft delete/restore. No
 * business logic, no auth checks; see `repository.ts` for the split map
 * and conventions.
 */

export interface ListEntriesOpts {
  /** When provided, only entries directly under this folder. NULL = base root. */
  folderId?: string | null;
  /** Default true. Set false to skip the heavy `body` column. */
  includeBody?: boolean;
  includeDeleted?: boolean;
  /** Page size; absent = all rows (legacy full-list behavior). */
  limit?: number;
  /** Row offset for paging; only meaningful with `limit`. */
  offset?: number;
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

/**
 * List every active entry directly inside (kb, folder), title only.
 * Used by the path resolver's slug-based fallback — when a strict title
 * match misses, the resolver scans this bucket and slug-matches
 * client-side. Bounded by parent folder, so the list is small.
 */
export async function listActiveEntryTitlesIn(
  baseId: string,
  folderId: string | null
): Promise<Array<{ id: string; title: string }>> {
  const db = supabaseAdmin();
  let query = db
    .from("knowledge_entries")
    .select("id, title")
    .eq("knowledge_base_id", baseId)
    .is("deleted_at", null);
  if (folderId === null) query = query.is("folder_id", null);
  else query = query.eq("folder_id", folderId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Array<{ id: string; title: string }>;
}

/** Hydrate a full entry by id. Used after the slug fallback identifies one. */
export async function findActiveEntryById(
  entryId: string
): Promise<KnowledgeEntry | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("knowledge_entries")
    .select(KNOWLEDGE_ENTRY_COLS)
    .eq("id", entryId)
    .is("deleted_at", null)
    .maybeSingle();
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
    .order("created_at", { ascending: true })
    // Deterministic tiebreak so paged reads never repeat/skip rows on
    // position/created_at ties.
    .order("id", { ascending: true });
  if (opts.limit !== undefined) {
    const offset = opts.offset ?? 0;
    query = query.range(offset, offset + opts.limit - 1);
  }
  const { data, error } = await query;
  if (error) throw error;
  if (includeBody) {
    return ((data ?? []) as unknown as KnowledgeEntryRow[]).map(mapEntryRow);
  }
  return ((data ?? []) as unknown as KnowledgeEntryMetaRow[]).map((row) =>
    mapEntryRow({ ...row, body: "" })
  );
}

/**
 * Highest `position` among active entries in a (base, folder) bucket, or
 * -1 when the bucket is empty. Lets `insertEntry` append with `max + 1`
 * so the caller's insertion order survives in position-sorted views (F-8)
 * instead of every new row landing at 0 and collapsing to an alphabetical
 * tiebreak in get_tree.
 */
export async function maxEntryPositionIn(
  baseId: string,
  folderId: string | null
): Promise<number> {
  const db = supabaseAdmin();
  let query = db
    .from("knowledge_entries")
    .select("position")
    .eq("knowledge_base_id", baseId)
    .is("deleted_at", null)
    .order("position", { ascending: false })
    .limit(1);
  if (folderId === null) query = query.is("folder_id", null);
  else query = query.eq("folder_id", folderId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data ? ((data as { position: number }).position ?? -1) : -1;
}

/** Active (non-deleted) entry count for a base — tree paging metadata. */
export async function countEntriesForBase(baseId: string): Promise<number> {
  const db = supabaseAdmin();
  const { count, error } = await db
    .from("knowledge_entries")
    .select("id", { count: "exact", head: true })
    .eq("knowledge_base_id", baseId)
    .is("deleted_at", null);
  if (error) throw error;
  return count ?? 0;
}

/**
 * Batch id lookup for active entries — name resolution for ontology
 * knowledge-attribute refs (`GET /api/knowledge/entries?ids=`). Meta
 * only (bodies stripped) and workspace-filtered because callers pass
 * untrusted ids; base-visibility gating happens in the service.
 */
export async function listEntriesByIds(
  workspaceId: string,
  ids: string[]
): Promise<KnowledgeEntry[]> {
  if (ids.length === 0) return [];
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("knowledge_entries")
    .select(KNOWLEDGE_ENTRY_META_COLS)
    .eq("workspace_id", workspaceId)
    .in("id", ids)
    .is("deleted_at", null);
  if (error) throw error;
  return ((data ?? []) as unknown as KnowledgeEntryMetaRow[]).map((row) =>
    mapEntryRow({ ...row, body: "" })
  );
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
  // F-8: append after the current siblings when the caller didn't pin a
  // position, so insertion order is preserved. Concurrent inserts can
  // race to the same value — acceptable, since position is a display
  // hint and the (created_at, id) tiebreak keeps ordering deterministic.
  const position =
    args.position ??
    (await maxEntryPositionIn(args.knowledgeBaseId, args.folderId ?? null)) + 1;
  const { data, error } = await db
    .from("knowledge_entries")
    .insert({
      workspace_id: args.workspaceId,
      knowledge_base_id: args.knowledgeBaseId,
      folder_id: args.folderId ?? null,
      title: stripNulls(args.title),
      excerpt: stripNulls(args.excerpt ?? null),
      body: stripNulls(args.body ?? ""),
      entry_type: args.entryType ?? "note",
      position,
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
): Promise<KnowledgeEntry>;
export async function updateEntryRow(
  id: string,
  patch: UpdateEntryPatch,
  expectedUpdatedAt: string | undefined
): Promise<KnowledgeEntry | null>;
export async function updateEntryRow(
  id: string,
  patch: UpdateEntryPatch,
  expectedUpdatedAt?: string
): Promise<KnowledgeEntry | null> {
  const db = supabaseAdmin();
  const update: Record<string, unknown> = {};
  if (patch.title !== undefined) update.title = stripNulls(patch.title);
  if (patch.excerpt !== undefined) update.excerpt = stripNulls(patch.excerpt);
  if (patch.body !== undefined) update.body = stripNulls(patch.body);
  if (patch.entryType !== undefined) update.entry_type = patch.entryType;
  if (patch.folderId !== undefined) update.folder_id = patch.folderId;
  if (patch.position !== undefined) update.position = patch.position;
  if (patch.lastEditedBy !== undefined) update.last_edited_by = patch.lastEditedBy;
  if (patch.lastEditedSource !== undefined)
    update.last_edited_source = patch.lastEditedSource;
  // Optimistic concurrency CAS (see updateBaseRow).
  let query = db.from("knowledge_entries").update(update).eq("id", id);
  if (expectedUpdatedAt !== undefined) {
    query = query.eq("updated_at", expectedUpdatedAt);
  }
  const { data, error } = await query.select(KNOWLEDGE_ENTRY_COLS).maybeSingle();
  if (error) throw error;
  if (!data) {
    if (expectedUpdatedAt !== undefined) return null;
    throw new Error("Failed to update knowledge entry");
  }
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
