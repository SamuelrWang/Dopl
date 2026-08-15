import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { KnowledgeContext } from "../types";
import { embedQuery } from "./embeddings";
import { KnowledgeBaseNotFoundError } from "./errors";
import * as repo from "./repository";
import { listBases } from "./service";

/**
 * Search across the workspace's knowledge entries. Hybrid by default:
 * `search_knowledge_hybrid` fuses vector similarity over
 * `knowledge_entry_chunks` with the tsvector keyword rank (RRF). No embeddings
 * (no key, API failure) → falls back to pure-FTS `search_knowledge_entries`;
 * search never breaks, only gets less semantic.
 *
 * ⚠ Keyword-hit snippets carry HTML `<b>` tags around matched terms
 * (vector-only hits are plain text) — strip or render at the UI layer.
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
 * One `search_knowledge_entries` row. Manual because `supabaseAdmin()` returns
 * an untyped `SupabaseClient` (no `Database` generic), so `.rpc(...)` yields
 * `unknown`; typing the admin client would need 240+ call sites to compile.
 * ⚠ Gen types declare `excerpt` / `folder_id` non-null because RETURN TABLE
 * loses nullability — the real columns ARE nullable.
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

  // ⚠ Visibility + team-scope gate — the RPC applies NO visibility filter, so
  // without this private bases' entries leak into results.
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
  // ⚠ SECURITY: `p_workspace_id` MUST come from `ctx.workspaceId`, never from
  // client input. RPCs are SECURITY INVOKER but the admin client bypasses RLS,
  // so they trust whatever workspace_id we pass.
  const ftsArgs = {
    p_workspace_id: ctx.workspaceId,
    p_query: trimmed,
    p_base_id: baseId,
    p_limit: opts.limit ?? 20,
  };
  let result: { data: unknown; error: { message?: string } | null } | null = null;
  const queryEmbedding = await embedQuery(trimmed);
  if (queryEmbedding) {
    result = await db.rpc("search_knowledge_hybrid", {
      ...ftsArgs,
      p_embedding: queryEmbedding,
    });
    if (result.error) {
      // Hybrid RPC missing/unhealthy (migration not applied) — degrade to
      // pure FTS rather than breaking search.
      console.error(
        "[knowledge-search] hybrid RPC failed, falling back to FTS:",
        result.error.message
      );
      result = null;
    }
  }
  if (!result) result = await db.rpc("search_knowledge_entries", ftsArgs);
  const { data, error } = result;
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
