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
 * Keyword-hit snippets carry HTML `<b>` tags around matched terms (vector-only
 * hits are plain text) — strip or render at the UI layer.
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
  /**
   * 🔒 **THE TWO HALVES OF THE ADDRESS A FOLLOW-UP READ NEEDS** (Wave 4,
   * 2026-09-18). A hit used to carry an entry id and nothing that
   * `read_file(base, path)` takes, so the agent that found the right entry
   * still had to hunt for where it lived. Both are derived from rows this
   * function already read — no extra query per hit.
   */
  baseSlug?: string;
  /** `folder/sub/Title` — what `op="read_file"` takes as `path`. */
  path?: string;
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
 * Gen types declare `excerpt` / `folder_id` non-null because RETURN TABLE loses
 * nullability; the real columns are nullable.
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

interface RpcArgs {
  p_workspace_id: string;
  p_query: string;
  p_base_id: string | null;
  p_limit: number;
}

/** One container's ranked rows: hybrid when there is an embedding, else (or on
 *  a failing hybrid RPC) pure FTS. Search never breaks, only gets less semantic. */
async function rankedRows(
  args: RpcArgs,
  embedding: string | null
): Promise<RpcRow[]> {
  const db = supabaseAdmin();
  if (embedding) {
    const hybrid = await db.rpc("search_knowledge_hybrid", { ...args, p_embedding: embedding });
    if (!hybrid.error) return (hybrid.data ?? []) as RpcRow[];
    console.error(
      "[knowledge-search] hybrid RPC failed, falling back to FTS:",
      hybrid.error.message
    );
  }
  const { data, error } = await db.rpc("search_knowledge_entries", args);
  if (error) throw error;
  return (data ?? []) as RpcRow[];
}

export async function searchKnowledgeEntries(
  ctx: KnowledgeContext,
  query: string,
  opts: SearchOpts = {}
): Promise<SearchHit[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  // Visibility + team-scope gate: the RPC applies no visibility filter, so
  // without this private bases' entries leak into results.
  const readable = await listBases(ctx);
  const readableIds = new Set(readable.map((b) => b.id));
  if (readableIds.size === 0) return [];

  // One RPC per CONTAINER the readable bases live in: in a home channel that
  // is the channel plus the caller's Home space, whose bases `listBases`
  // already admits there (both shelves). The RPC is keyed to one workspace, so
  // searching `ctx.workspaceId` alone missed every Home base. Ids come from
  // server-read rows, never client input (the RPC trusts what it is given).
  let scopes: { workspaceId: string; baseId: string | null }[];
  if (opts.baseSlug) {
    const named = readable.filter((b) => b.slug === opts.baseSlug);
    // A slug can repeat across the two shelves: the calling container wins.
    const base = named.find((b) => b.workspaceId === ctx.workspaceId) ?? named[0];
    if (!base) throw new KnowledgeBaseNotFoundError(opts.baseSlug);
    scopes = [{ workspaceId: base.workspaceId, baseId: base.id }];
  } else {
    scopes = [...new Set(readable.map((b) => b.workspaceId))].map((workspaceId) => ({
      workspaceId,
      baseId: null,
    }));
  }

  const limit = opts.limit ?? 20;
  const queryEmbedding = await embedQuery(trimmed);
  const perScope = await Promise.all(
    scopes.map((scope) =>
      rankedRows({
        p_workspace_id: scope.workspaceId,
        p_query: trimmed,
        p_base_id: scope.baseId,
        p_limit: limit,
      }, queryEmbedding)
    )
  );
  // Each scope ranks on the same scale (RRF, else ts_rank), so a merge by rank
  // keeps the best `limit` across containers.
  const rows = perScope
    .flat()
    .filter((row) => readableIds.has(row.knowledge_base_id))
    .sort((a, b) => b.rank - a.rank)
    .slice(0, limit);

  // 🔒 **THE ADDRESS, BUILT ONCE PER BASE THAT HAS A HIT** — never per hit. The
  // folder list is one query for a whole base and the result set is capped at
  // 100, so the join is bounded by the number of DISTINCT bases in it.
  const slugOf = new Map(readable.map((b) => [b.id, b.slug]));
  const hitBaseIds = [...new Set(rows.map((r) => r.knowledge_base_id))];
  const folderPaths = new Map<string, Map<string, string>>();
  await Promise.all(
    hitBaseIds.map(async (id) => {
      const folders = await repo.listFoldersForBase(id, false);
      const byId = new Map(folders.map((f) => [f.id, f]));
      const paths = new Map<string, string>();
      for (const f of folders) {
        const segments: string[] = [];
        // ⚠ BOUNDED BY THE MAP, not by a depth constant: a parent chain that
        // loops (or points outside this base) stops rather than spinning.
        let cursor: typeof f | undefined = f;
        const seen = new Set<string>();
        while (cursor && !seen.has(cursor.id)) {
          seen.add(cursor.id);
          segments.unshift(cursor.name);
          cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
        }
        paths.set(f.id, segments.join("/"));
      }
      folderPaths.set(id, paths);
    })
  );

  return rows.map((row) => {
    const folder = row.folder_id
      ? folderPaths.get(row.knowledge_base_id)?.get(row.folder_id)
      : undefined;
    const slug = slugOf.get(row.knowledge_base_id);
    return {
      entryId: row.entry_id,
      knowledgeBaseId: row.knowledge_base_id,
      folderId: row.folder_id,
      title: row.title,
      excerpt: row.excerpt,
      snippet: row.snippet,
      rank: row.rank,
      updatedAt: row.updated_at,
      ...(slug ? { baseSlug: slug } : {}),
      path: folder ? `${folder}/${row.title}` : row.title,
    };
  });
}
