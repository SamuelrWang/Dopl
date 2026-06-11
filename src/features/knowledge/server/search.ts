import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { KnowledgeContext } from "../types";
import { KnowledgeBaseNotFoundError } from "./errors";
import * as repo from "./repository";
import { listBases } from "./service";

/**
 * Full-text search across the workspace's knowledge entries (Item 5.D).
 * Backed by the `search_knowledge_entries` Postgres RPC + a tsvector
 * GIN index from migration 20260501020000_knowledge_fulltext.
 *
 * Path: client → REST `/api/knowledge/search` → service → RPC → results.
 *
 * Snippets returned by the RPC use HTML `<b>` tags around matched
 * terms — strip or render at the UI layer.
 */

export interface SearchHit {
  entryId: string;
  knowledgeBaseId: string;
  folderId: string | null;
  title: string;
  excerpt: string | null;
  snippet: string;
  rank: number;
  updatedAt: string;
}

export interface SearchOpts {
  /** Optional — restrict to one base. Resolved to id if a slug is passed. */
  baseSlug?: string;
  /** Defaults to 20. Capped at 100. */
  limit?: number;
}

/**
 * The shape of one row returned by `search_knowledge_entries`. The
 * regenerated supabase types in `src/shared/supabase/types.ts` declare
 * this RPC, but `supabaseAdmin()` returns an untyped `SupabaseClient`
 * (no `Database` generic), so every `.rpc(...)` call falls back to
 * `unknown`. Until the admin client is typed (tracked as a follow-up
 * finding — 240+ call sites would need to compile), keep this manual
 * shape for the local cast. Note: gen types declare `excerpt` /
 * `folder_id` as non-null because RETURN TABLE doesn't preserve
 * nullability — the real columns are nullable.
 */
interface RpcRow {
  entry_id: string;
  knowledge_base_id: string;
  folder_id: string | null;
  title: string;
  excerpt: string | null;
  snippet: string;
  rank: number;
  updated_at: string;
}

export async function searchKnowledgeEntries(
  ctx: KnowledgeContext,
  query: string,
  opts: SearchOpts = {}
): Promise<SearchHit[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  // Visibility + team-scope gate: only search bases the caller can read.
  // Also closes the historical gap where private bases' entries leaked
  // into search results (the RPC itself applies no visibility filter).
  const readable = await listBases(ctx);
  const readableIds = new Set(readable.map((b) => b.id));
  if (readableIds.size === 0) return [];

  let baseId: string | null = null;
  if (opts.baseSlug) {
    const base = await repo.findBaseBySlug(ctx.workspaceId, opts.baseSlug, false);
    if (!base || !readableIds.has(base.id)) {
      throw new KnowledgeBaseNotFoundError(opts.baseSlug);
    }
    baseId = base.id;
  }

  const db = supabaseAdmin();
  // SECURITY: `p_workspace_id` MUST come from the auth context
  // (`ctx.workspaceId`), never from client-controllable input. The RPC is
  // SECURITY INVOKER but the admin client bypasses RLS, so the function
  // trusts whatever workspace_id we pass. Audit fix #11.
  const { data, error } = await db.rpc("search_knowledge_entries", {
    p_workspace_id: ctx.workspaceId,
    p_query: trimmed,
    p_base_id: baseId,
    p_limit: opts.limit ?? 20,
  });
  if (error) throw error;

  return ((data ?? []) as RpcRow[])
    .filter((row) => readableIds.has(row.knowledge_base_id))
    .map((row) => ({
    entryId: row.entry_id,
    knowledgeBaseId: row.knowledge_base_id,
    folderId: row.folder_id,
    title: row.title,
    excerpt: row.excerpt,
    snippet: row.snippet,
    rank: row.rank,
    updatedAt: row.updated_at,
  }));
}
