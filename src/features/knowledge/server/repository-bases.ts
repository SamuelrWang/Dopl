import "server-only";
import { generatePublicId } from "@/shared/lib/id/public-id";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { KnowledgeBase } from "../types";
import {
  KNOWLEDGE_BASE_COLS,
  mapBaseRow,
  type KnowledgeBaseRow,
} from "./dto";

/**
 * Raw Supabase I/O for knowledge BASES — reads, writes, cascade
 * trash/restore, and owner-name hydration. No business logic, no auth
 * checks; see `repository.ts` for the split map and conventions.
 */

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

/** Batch id lookup — trash visibility filtering (parents of trashed
 *  folders/entries may be live or trashed, so deleted rows are
 *  included). Workspace-filtered because callers pass untrusted ids. */
export async function listBasesByIds(
  workspaceId: string,
  ids: string[]
): Promise<KnowledgeBase[]> {
  if (ids.length === 0) return [];
  const db = supabaseAdmin();
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

export async function findBaseByPublicId(
  workspaceId: string,
  publicId: string,
  includeDeleted = false
): Promise<KnowledgeBase | null> {
  const db = supabaseAdmin();
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
 * only ACTIVE slugs (deleted_at IS NULL) to match the partial-unique
 * index that's still in place — slug uniqueness within a workspace
 * survives the publicId rollout because MCP tools (`kb_*`) address
 * bases by slug.
 */
export async function listBaseSlugsForWorkspace(
  workspaceId: string
): Promise<string[]> {
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
  /** Persisted as `'public'` if omitted (matches DB column default).
   *  App code passes `'private'` for new items so they start as drafts;
   *  see `createBase` in service.ts. */
  visibility?: "public" | "private";
  /** `'workspace'` if omitted (matches DB column default). */
  accessMode?: "workspace" | "teams";
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
      public_id: generatePublicId(),
      description: args.description ?? null,
      agent_write_enabled: args.agentWriteEnabled ?? false,
      visibility: args.visibility ?? "public",
      access_mode: args.accessMode ?? "workspace",
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
  /** Two-way — the service layer gates who may change scope and runs
   *  the workflow↔KB narrowing invariant; this repo function takes
   *  whatever it's given and trusts the caller. */
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
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.slug !== undefined) update.slug = patch.slug;
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.agentWriteEnabled !== undefined)
    update.agent_write_enabled = patch.agentWriteEnabled;
  if (patch.visibility !== undefined) update.visibility = patch.visibility;
  if (patch.accessMode !== undefined) update.access_mode = patch.accessMode;
  // Optimistic concurrency: when expectedUpdatedAt is supplied, the
  // `updated_at` filter makes this an atomic compare-and-swap. 0 rows →
  // the row changed since the caller read it → return null (stale).
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
