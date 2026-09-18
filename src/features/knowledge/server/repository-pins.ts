import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { KnowledgeEntry } from "../types";
import {
  KNOWLEDGE_ENTRY_COLS,
  mapEntryRow,
  type KnowledgeEntryRow,
} from "./dto";

/**
 * Raw Supabase I/O for PINNED STARTUP CONTEXT (T81) — the `pinned` boolean on
 * `knowledge_bases` and `knowledge_entries`
 * (`20260908120000_knowledge_pinned_startup_context.sql`). No business logic, no
 * auth checks — see `repository.ts` for the split map and conventions.
 *
 * Every function here takes and filters `workspace_id`. This client is the
 * SERVICE ROLE and bypasses RLS entirely (INVARIANTS §2), so each
 * `.eq("workspace_id", …)` IS the fence rather than a hint.
 *
 * A `workspace_id` filter is not a VISIBILITY filter: nothing here knows about
 * `visibility`, teams or the agent audience ceiling, so every base-id set
 * arriving here must already have come out of a fenced read
 * (`service-bases.ts › listBases` / `› getBaseById`). The id set is the fence,
 * exactly as `repository-stars.ts › listStarredBaseIds` requires.
 *
 * `pinned` is filtered and set but never SELECTED — it is absent from
 * `dto.ts › KNOWLEDGE_BASE_COLS` / `› KNOWLEDGE_ENTRY_COLS` on purpose, which is
 * what keeps clients from re-deriving the read.
 */

/**
 * WHICH of `baseIds` are pinned — the fold behind
 * `GET /api/knowledge/bases › pinnedBaseIds`. One query for N bases.
 *
 * Callers must pass the post-visibility list (see the module docblock).
 */
export async function listPinnedBaseIds(
  workspaceId: string,
  baseIds: string[]
): Promise<string[]> {
  if (baseIds.length === 0) return [];
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("knowledge_bases")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("pinned", true)
    .in("id", baseIds);
  if (error) throw error;
  return ((data ?? []) as unknown as Array<{ id: string }>).map((r) => r.id);
}

/**
 * Set (or clear) a base's pin. IDEMPOTENT — the write states the END STATE, so
 * a retry after an ambiguous failure lands on the same row value rather than
 * flipping it back (the two-verb argument in
 * `app/api/knowledge/bases/[baseId]/star/route.ts`).
 *
 * No `select()`, and no "0 rows" error either: an update matching nothing
 * (already-gone base, foreign workspace) must be indistinguishable from one
 * matching a row, or it becomes an existence oracle.
 */
export async function setBasePinned(
  workspaceId: string,
  baseId: string,
  pinned: boolean
): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db
    .from("knowledge_bases")
    .update({ pinned })
    .eq("id", baseId)
    .eq("workspace_id", workspaceId);
  if (error) throw error;
}

/** Set (or clear) ONE entry's pin. Same idempotence and same silence as
 *  {@link setBasePinned}. */
export async function setEntryPinned(
  workspaceId: string,
  entryId: string,
  pinned: boolean
): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db
    .from("knowledge_entries")
    .update({ pinned })
    .eq("id", entryId)
    .eq("workspace_id", workspaceId);
  if (error) throw error;
}

/**
 * The startup-context payload's entries, in ONE round trip.
 *
 * "Pinned" here has TWO arms, and they are OR-ed inside a single statement
 * rather than fetched as two lists:
 *   1. every live entry of a PINNED BASE (`baseIds` ∩ `pinnedBaseIds`), and
 *   2. every individually PINNED entry anywhere in `baseIds`.
 * The two overlap — a pinned entry inside a pinned base — and the service
 * de-dupes on entry id.
 *
 * `baseIds` is the whole fence and `pinnedBaseIds` is a SUBSET of it: the
 * `.in()` is applied to the outer statement, so arm 1 can never reach outside
 * the post-visibility set even on a stale pinned-id list.
 *
 * Bounded fan, not a query per base — the point of the `or()`.
 *
 * It carries a `limit` and reports reaching it (INVARIANTS §9): `rows.length
 * === limit` is indistinguishable from "there were more", so the caller treats
 * AT as OVER. Ordered deterministically — base, then the tree order
 * `repository-entries.ts › listEntriesForBase` uses — so a clip always keeps the
 * same rows and a pinned base arrives whole or clipped at its tail.
 */
export async function listPinnedEntriesForBases(
  workspaceId: string,
  baseIds: string[],
  pinnedBaseIds: string[],
  limit: number
): Promise<KnowledgeEntry[]> {
  if (baseIds.length === 0) return [];
  // Arm 1 has nothing to add when no base is pinned; spelling it as `or()`
  // anyway would send PostgREST an empty `in.()` list.
  const arms =
    pinnedBaseIds.length > 0
      ? `knowledge_base_id.in.(${pinnedBaseIds.join(",")}),pinned.eq.true`
      : null;
  const db = supabaseAdmin();
  let query = db
    .from("knowledge_entries")
    .select(KNOWLEDGE_ENTRY_COLS)
    .eq("workspace_id", workspaceId)
    .in("knowledge_base_id", baseIds)
    .is("deleted_at", null);
  query = arms ? query.or(arms) : query.eq("pinned", true);
  const { data, error } = await query
    .order("knowledge_base_id", { ascending: true })
    .order("position", { ascending: true })
    .order("created_at", { ascending: true })
    // Deterministic tiebreak, the same one `listEntriesForBase` carries: a
    // clipped read repeats or skips rows on position/created_at ties without it.
    .order("id", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return ((data ?? []) as unknown as KnowledgeEntryRow[]).map(mapEntryRow);
}

/** One folder's identity + parent, the minimum a path build needs. camelCase:
 *  no snake_case key leaves this layer. */
export interface KnowledgeFolderNode {
  id: string;
  knowledgeBaseId: string;
  parentId: string | null;
  name: string;
}

/**
 * The folder skeleton of a SET of bases, in ONE query — four columns, no
 * descriptions, no timestamps.
 *
 * It exists because a startup-context item carries a `path`, and
 * `repository-folders.ts › listFoldersForBase` answers for ONE base, so
 * composing it would put a round trip per pinned base on the launch path. Not a
 * general folder read: four columns and nothing else (INVARIANTS §9).
 *
 * Active folders only. A folder trashed under a live entry leaves a gap the
 * service renders as the entry's title alone rather than inventing a segment.
 */
export async function listFolderNodesForBases(
  workspaceId: string,
  baseIds: string[]
): Promise<KnowledgeFolderNode[]> {
  if (baseIds.length === 0) return [];
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("knowledge_folders")
    .select("id, knowledge_base_id, parent_id, name")
    .eq("workspace_id", workspaceId)
    .in("knowledge_base_id", baseIds)
    .is("deleted_at", null);
  if (error) throw error;
  return (
    (data ?? []) as unknown as Array<{
      id: string;
      knowledge_base_id: string;
      parent_id: string | null;
      name: string;
    }>
  ).map((row) => ({
    id: row.id,
    knowledgeBaseId: row.knowledge_base_id,
    parentId: row.parent_id,
    name: row.name,
  }));
}
