import "server-only";
import { generatePublicId } from "@/shared/lib/id/public-id";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { readClient } from "@/shared/supabase/caller-client";
import {
  personalWriteWorkspaceId,
  resolveShelfScope,
} from "@/shared/tenancy/personal-container";
import type { KbShelf, KnowledgeBase } from "../types";
import {
  KNOWLEDGE_BASE_COLS,
  mapBaseRow,
  stripNulls,
  type KnowledgeBaseRow,
} from "./dto";

/**
 * Raw Supabase I/O for knowledge BASES. No business logic, no auth checks —
 * see `repository.ts` for the split map and conventions.
 *
 * Two clients: a read that answers "what may this caller see" takes
 * `readClient()` (the caller's client when `RLS_CALLER_SCOPED_READS` is on,
 * where the row filter is the policy written to equal the TS predicate). A read
 * that answers a SYSTEM question keeps `supabaseAdmin()` and says so at the call
 * site — slug uniqueness and storage accounting must see rows the caller cannot,
 * or a slug reads "free" because someone else's private base holds it. Writes
 * stay on the service role until RLS phase 4.
 */

export async function findBaseById(
  id: string,
  includeDeleted = false
): Promise<KnowledgeBase | null> {
  const db = readClient();
  let query = db.from("knowledge_bases").select(KNOWLEDGE_BASE_COLS).eq("id", id);
  if (!includeDeleted) query = query.is("deleted_at", null);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data ? mapBaseRow(data as KnowledgeBaseRow) : null;
}

/** Batch id lookup. Deleted rows INCLUDED (parents of trashed children may
 *  themselves be trashed). Workspace-filtered — callers pass untrusted ids. */
export async function listBasesByIds(
  workspaceId: string,
  ids: string[]
): Promise<KnowledgeBase[]> {
  if (ids.length === 0) return [];
  const db = readClient();
  const { data, error } = await db
    .from("knowledge_bases")
    .select(KNOWLEDGE_BASE_COLS)
    .eq("workspace_id", workspaceId)
    .in("id", ids);
  if (error) throw error;
  return ((data ?? []) as KnowledgeBaseRow[]).map(mapBaseRow);
}

export async function findBaseBySlug(
  workspaceId: string,
  slug: string,
  includeDeleted = false
): Promise<KnowledgeBase | null> {
  const db = readClient();
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

export async function findBaseByPublicId(
  workspaceId: string,
  publicId: string,
  includeDeleted = false
): Promise<KnowledgeBase | null> {
  const db = readClient();
  let query = db
    .from("knowledge_bases")
    .select(KNOWLEDGE_BASE_COLS)
    .eq("workspace_id", workspaceId)
    .eq("public_id", publicId);
  if (!includeDeleted) query = query.is("deleted_at", null);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data ? mapBaseRow(data as KnowledgeBaseRow) : null;
}

/**
 * One workspace's bases, optionally narrowed to ONE SHELF.
 *
 * `shelf` undefined is NO filter, not a default shelf: MCP `kb_list_bases`,
 * workspace search and the lazy-seed count in `service-bases.ts › listBases`
 * all need both shelves, or a workspace whose bases are all home-scoped
 * re-seeds on every list call.
 *
 * The shelf is a TENANCY, not a `WHERE`: `shelf="home"` is the caller's personal
 * container, and `shared/tenancy/personal-container.ts` decides the scope.
 */
export async function listBasesForWorkspace(
  workspaceId: string,
  includeDeleted = false,
  shelf?: KbShelf
): Promise<KnowledgeBase[]> {
  const db = readClient();
  const scope = await resolveShelfScope(workspaceId, shelf);
  let query = db
    .from("knowledge_bases")
    .select(KNOWLEDGE_BASE_COLS)
    .in("workspace_id", scope.workspaceIds)
    .order("created_at", { ascending: true });
  if (!includeDeleted) query = query.is("deleted_at", null);
  const { data, error } = await query;
  if (error) throw error;
  return ((data ?? []) as KnowledgeBaseRow[]).map(mapBaseRow);
}

/**
 * WHICH of `baseIds` are in the caller's PERSONAL container — the fold behind
 * `GET /api/knowledge/bases › homeScopedBaseIds`. One query for N bases.
 *
 * Callers MUST pass the post-visibility list: the id set IS the fence (same
 * requirement as `repository-stars.ts › listStarredBaseIds`), since this applies
 * no visibility of its own.
 *
 * It asks the same question `listBasesForWorkspace(_, _, "home")` asks, through
 * the same {@link resolveShelfScope}, so the label cannot disagree with the list.
 */
export async function listHomeScopedBaseIds(
  workspaceId: string,
  baseIds: string[]
): Promise<string[]> {
  if (baseIds.length === 0) return [];
  const scope = await resolveShelfScope(workspaceId, "home");
  if (scope.workspaceIds.length === 0) return [];
  const { data, error } = await readClient()
    .from("knowledge_bases")
    .select("id")
    .in("workspace_id", scope.workspaceIds)
    .in("id", baseIds);
  if (error) throw error;
  return ((data ?? []) as unknown as Array<{ id: string }>).map((r) => r.id);
}

/**
 * ACTIVE slugs only (`deleted_at IS NULL`), matching the partial-unique index.
 * Slug uniqueness persists alongside publicId because MCP `kb_*` tools address
 * bases by slug.
 */
export async function listBaseSlugsForWorkspace(
  workspaceId: string
): Promise<string[]> {
  // System read, service role on purpose: uniqueness spans rows the caller
  // cannot see — scoped to the caller, a taken slug would read as free.
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("knowledge_bases")
    .select("slug")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null);
  if (error) throw error;
  return ((data ?? []) as Array<{ slug: string }>).map((r) => r.slug);
}

export interface InsertBaseArgs {
  workspaceId: string;
  name: string;
  slug: string;
  description?: string | null;
  agentWriteEnabled?: boolean;
  /** `'public'` if omitted (DB column default). App code passes `'private'`
   *  for new items so they start as drafts; see `createBase`. */
  visibility?: "public" | "private";
  /** `'workspace'` if omitted (matches DB column default). */
  accessMode?: "workspace" | "teams";
  /**
   * WHICH SHELF (`../types.ts › KbShelf`). A routing flag, not a column: it
   * decides the row's `workspace_id` and nothing stores it. Absent = the
   * container the call is in; only `createBase` ever passes `true`.
   */
  homeScoped?: boolean;
  createdBy: string | null;
  /** S53 idempotency — see {@link findBaseByClientWriteId}. Author-stamped,
   *  because the unique index is author-scoped. */
  clientWriteId?: string | null;
  clientWriteBy?: string | null;
}

/**
 * 🔒 **THE CREATE'S IDEMPOTENCY PROBE — (container, key, AUTHOR)** (S53).
 * Same shape, same author-scope argument and same "the database agrees with this
 * function" caveat as `repository-entries.ts › findEntryByClientWriteId`; the
 * index is `(workspace_id, client_write_id, client_write_by)`.
 */
export async function findBaseByClientWriteId(
  workspaceId: string,
  clientWriteId: string,
  clientWriteBy: string | null
): Promise<KnowledgeBase | null> {
  if (!clientWriteBy) return null;
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("knowledge_bases")
    .select(KNOWLEDGE_BASE_COLS)
    .eq("workspace_id", workspaceId)
    .eq("client_write_id", clientWriteId)
    .eq("client_write_by", clientWriteBy)
    .maybeSingle();
  if (error) throw error;
  return data ? mapBaseRow(data as KnowledgeBaseRow) : null;
}

/** Shared by single AND batch insert so column defaults can't drift.
 *  `workspaceId` is the RESOLVED one — see {@link insertBase}. */
function baseInsertRow(args: InsertBaseArgs) {
  return {
    workspace_id: args.workspaceId,
    name: stripNulls(args.name),
    slug: args.slug,
    public_id: generatePublicId(),
    description: stripNulls(args.description ?? null),
    agent_write_enabled: args.agentWriteEnabled ?? false,
    visibility: args.visibility ?? "public",
    access_mode: args.accessMode ?? "workspace",
    created_by: args.createdBy,
    // ⚠ OMITTED ENTIRELY WITHOUT A KEY (S53) — see `repository-entries.ts ›
    // insertEntry` for why a NULL here would make an unapplied migration an
    // outage rather than a missing feature. ⚠ BOTH OR NEITHER: a key with no
    // author cannot converge, NULLs being distinct in the partial unique index.
    ...(args.clientWriteId
      ? {
          client_write_id: args.clientWriteId,
          client_write_by: args.clientWriteBy ?? null,
        }
      : {}),
  };
}

/**
 * A personal write lands in the container or refuses: `personalWriteWorkspaceId`
 * throws rather than guessing, because a fallback would write a row no surface
 * can find. Only `insertBase` can be personal, which is why {@link insertBases}
 * (the new-workspace seed) is not on this path.
 */
export async function insertBase(args: InsertBaseArgs): Promise<KnowledgeBase> {
  const db = supabaseAdmin();
  const workspaceId = await personalWriteWorkspaceId(args);
  const { data, error } = await db
    .from("knowledge_bases")
    .insert(baseInsertRow({ ...args, workspaceId }))
    .select(KNOWLEDGE_BASE_COLS)
    .single();
  if (error || !data) throw error || new Error("Failed to insert knowledge base");
  return mapBaseRow(data as KnowledgeBaseRow);
}

/** Many bases in ONE statement (new-workspace seed). Callers key results by
 *  `slug`, not index — nothing may depend on returned row order. */
export async function insertBases(
  argsList: InsertBaseArgs[]
): Promise<KnowledgeBase[]> {
  if (argsList.length === 0) return [];
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("knowledge_bases")
    .insert(argsList.map(baseInsertRow))
    .select(KNOWLEDGE_BASE_COLS);
  if (error || !data) throw error || new Error("Failed to insert knowledge bases");
  return (data as KnowledgeBaseRow[]).map(mapBaseRow);
}

export interface UpdateBasePatch {
  name?: string;
  slug?: string;
  description?: string | null;
  agentWriteEnabled?: boolean;
  /** Two-way. Service layer gates who may change scope; this repo function
   *  trusts the caller. */
  visibility?: "public" | "private";
  accessMode?: "workspace" | "teams";
}

export async function updateBaseRow(
  id: string,
  patch: UpdateBasePatch
): Promise<KnowledgeBase>;
export async function updateBaseRow(
  id: string,
  patch: UpdateBasePatch,
  expectedUpdatedAt: string | undefined
): Promise<KnowledgeBase | null>;
export async function updateBaseRow(
  id: string,
  patch: UpdateBasePatch,
  expectedUpdatedAt?: string
): Promise<KnowledgeBase | null> {
  const db = supabaseAdmin();
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = stripNulls(patch.name);
  if (patch.slug !== undefined) update.slug = patch.slug;
  if (patch.description !== undefined)
    update.description = stripNulls(patch.description);
  if (patch.agentWriteEnabled !== undefined)
    update.agent_write_enabled = patch.agentWriteEnabled;
  if (patch.visibility !== undefined) update.visibility = patch.visibility;
  if (patch.accessMode !== undefined) update.access_mode = patch.accessMode;
  // Optimistic concurrency: `updated_at` filter makes this an atomic CAS.
  // 0 rows → row changed since the caller read it → null (stale).
  let query = db.from("knowledge_bases").update(update).eq("id", id);
  if (expectedUpdatedAt !== undefined) {
    query = query.eq("updated_at", expectedUpdatedAt);
  }
  const { data, error } = await query.select(KNOWLEDGE_BASE_COLS).maybeSingle();
  if (error) throw error;
  if (!data) {
    if (expectedUpdatedAt !== undefined) return null;
    throw new Error("Failed to update knowledge base");
  }
  return mapBaseRow(data as KnowledgeBaseRow);
}

/**
 * PERMANENT delete of a base and everything inside — no trash. Workspace-scoped
 * as defense-in-depth; children cascade via `knowledge_base_id ... ON DELETE
 * CASCADE`, so one statement clears the subtree.
 */
export async function hardDeleteBase(
  workspaceId: string,
  id: string
): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db
    .from("knowledge_bases")
    .delete()
    .eq("id", id)
    .eq("workspace_id", workspaceId);
  if (error) throw error;
}

/**
 * `knowledge_bases.storage_bytes` for a SET of bases — the usage bar's `used`
 * half, one round trip for the grid.
 * SEPARATE QUERY, NOT a column in `KNOWLEDGE_BASE_COLS`: those feed
 * `mapBaseRow` → the `KnowledgeBase` interface that
 * `scripts/check-knowledge-type-drift.ts` pins field-for-field against the SDK
 * mirror, so adding the counter pushes a display-only number onto every MCP
 * `kb_*` payload. Same rationale as `types.ts › KnowledgeBaseStats`.
 */
export async function listBaseStorageBytes(
  workspaceId: string,
  baseIds: string[]
): Promise<Map<string, number>> {
  if (baseIds.length === 0) return new Map();
  // System read, service role on purpose: accounting, not visibility.
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("knowledge_bases")
    .select("id, storage_bytes")
    .eq("workspace_id", workspaceId)
    .in("id", baseIds);
  if (error) throw error;
  return new Map(
    ((data ?? []) as unknown as Array<{ id: string; storage_bytes: number | null }>).map(
      (row) => [row.id, Number(row.storage_bytes ?? 0)]
    )
  );
}

/**
 * One base's `storage_bytes` — the write gate's `used` reading.
 * `null` (row gone) must NOT be read as zero: the gate fails OPEN on an unknown
 * counter (see `service-storage.ts`).
 * Arrives as a JS `number` though the column is BIGINT — PostgREST serialises
 * int8 as JSON number and `supabase-js` doesn't re-widen. Exact to 2^53 bytes.
 */
export async function getBaseStorageBytes(
  workspaceId: string,
  baseId: string
): Promise<number | null> {
  // System read, service role on purpose: the write gate's quota reading.
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("knowledge_bases")
    .select("storage_bytes")
    .eq("id", baseId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return Number((data as { storage_bytes: number | null }).storage_bytes ?? 0);
}

/** Display names for base owners (list-pane attribution). */
export async function fetchProfileNames(
  userIds: string[]
): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("profiles")
    .select("id, email, display_name")
    .in("id", userIds);
  if (error) throw error;
  return new Map(
    (data ?? []).map((p) => [
      p.id as string,
      (p.display_name as string | null) ||
        (p.email as string | null) ||
        "Unknown member",
    ])
  );
}
