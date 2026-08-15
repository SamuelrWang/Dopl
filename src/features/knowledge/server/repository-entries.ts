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
 * Raw Supabase I/O for knowledge ENTRIES. No business logic, no auth checks —
 * see `repository.ts` for the split map and conventions.
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

/** By (kb, folder, title). Unique partial index guarantees max-1 active row.
 *  Used by the path resolver. */
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

/** Titles of active entries directly inside (kb, folder). Feeds the path
 *  resolver's slug fallback; bounded by parent folder, so small. */
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

/** Hydrate full entry by id, after the slug fallback identifies one. */
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
    // ⚠ Deterministic tiebreak: paged reads repeat/skip rows on
    // position/created_at ties without it.
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
 * Highest `position` among active entries in a (base, folder) bucket, -1 when
 * empty. `insertEntry` appends at `max + 1` so insertion order survives in
 * position-sorted views (F-8) instead of every row landing at 0 and collapsing
 * to an alphabetical tiebreak in get_tree.
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

/** Base + last-write stamp the service folds into per-base list stats.
 *  camelCase: no snake_case key leaves this layer. */
export interface EntryStamp {
  baseId: string;
  updatedAt: string;
}

/**
 * `(base, updated_at)` for a SET of bases in ONE query — the base list's
 * "{N} entries · updated {when}" columns. Two columns, no bodies:
 * `countEntriesForBase` is N round trips per grid, and a count/max aggregate
 * needs a grouped RPC for numbers the caller re-derives free. ⚠ `baseIds` is
 * the caller's POST-visibility set, so nothing hidden is counted.
 */
export async function listEntryStampsForBases(
  workspaceId: string,
  baseIds: string[]
): Promise<EntryStamp[]> {
  if (baseIds.length === 0) return [];
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("knowledge_entries")
    .select("knowledge_base_id, updated_at")
    .eq("workspace_id", workspaceId)
    .in("knowledge_base_id", baseIds)
    .is("deleted_at", null);
  if (error) throw error;
  return (
    (data ?? []) as unknown as Array<{
      knowledge_base_id: string;
      updated_at: string;
    }>
  ).map((row) => ({ baseId: row.knowledge_base_id, updatedAt: row.updated_at }));
}

/**
 * Batch id lookup for active entries (`GET /api/knowledge/entries?ids=`).
 * ⚠ Meta only and workspace-filtered because callers pass UNTRUSTED ids;
 * base-visibility gating happens in the service.
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
  // F-8: append after siblings when position unpinned, preserving insertion
  // order. Concurrent inserts may race to the same value — fine, position is a
  // display hint and the (created_at, id) tiebreak stays deterministic.
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

/**
 * Batch form of `InsertEntryArgs`. `position` is REQUIRED — the single-row
 * `maxEntryPositionIn` fallback would restore the per-row round trips the batch
 * exists to remove. `id` MAY be supplied so callers know each uuid before the
 * insert resolves — no second pass, no assumption about `RETURNING` order.
 */
export interface InsertEntriesArgs extends Omit<InsertEntryArgs, "position"> {
  id?: string;
  position: number;
}

/** Insert many entries in ONE statement. See `InsertEntriesArgs`. */
export async function insertEntries(
  argsList: InsertEntriesArgs[]
): Promise<KnowledgeEntry[]> {
  if (argsList.length === 0) return [];
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("knowledge_entries")
    .insert(
      argsList.map((args) => ({
        ...(args.id ? { id: args.id } : {}),
        workspace_id: args.workspaceId,
        knowledge_base_id: args.knowledgeBaseId,
        folder_id: args.folderId ?? null,
        title: stripNulls(args.title),
        excerpt: stripNulls(args.excerpt ?? null),
        body: stripNulls(args.body ?? ""),
        entry_type: args.entryType ?? "note",
        position: args.position,
        created_by: args.createdBy,
        last_edited_by: args.createdBy,
        last_edited_source: args.source,
      }))
    )
    .select(KNOWLEDGE_ENTRY_COLS);
  if (error || !data) throw error || new Error("Failed to insert knowledge entries");
  return (data as KnowledgeEntryRow[]).map(mapEntryRow);
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
  // Optimistic-concurrency CAS (see updateBaseRow).
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

/** PERMANENT delete — no trash. Workspace-scoped as defense-in-depth;
 *  embedding chunks cascade via FK. */
export async function hardDeleteEntry(
  workspaceId: string,
  id: string
): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db
    .from("knowledge_entries")
    .delete()
    .eq("id", id)
    .eq("workspace_id", workspaceId);
  if (error) throw error;
}
