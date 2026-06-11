import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import {
  listBasesForWorkspace,
  findBaseBySlug,
  listEntriesForBase,
  findEntryById,
} from "@/features/knowledge/server/repository";
import {
  effectiveResourceAccess,
  listEffectiveAccess,
  resolveLevel,
} from "@/features/teams/server/access";
import type { ToolResult } from "./types";

const supabase = supabaseAdmin();

/**
 * Workspace-shared knowledge-base reads exposed to the private chat.
 *
 * Visibility rules:
 *   • A KB with `visibility='private'` is only readable when its
 *     `created_by` matches the calling user. The repository helpers use
 *     the service-role client (bypass RLS) so we filter explicitly here
 *     in the same shape RLS enforces.
 *   • Soft-deleted rows are excluded by the repository helpers (they
 *     filter `deleted_at IS NULL` by default).
 *
 * `scopeFilters?.kbIds` narrows the result set to a user-selected subset
 * of bases when the per-chat scope picker has been used. NULL/undefined
 * = no narrowing (search the whole workspace).
 */

export interface KnowledgeScopeFilters {
  kbIds?: string[];
}

function visibleBaseFilter<
  T extends { id: string; visibility: "public" | "private"; createdBy: string | null }
>(bases: T[], userId: string, kbIds?: string[]): T[] {
  return bases.filter((b) => {
    if (kbIds && kbIds.length > 0 && !kbIds.includes(b.id)) return false;
    if (b.visibility === "private" && b.createdBy !== userId) return false;
    return true;
  });
}

/**
 * Visibility + team-scope resolution in one place: applies the private-
 * ownership filter, then drops teams-mode bases the caller has no grant
 * on (one batch query; workspace-mode bases pass through).
 */
async function listVisibleBases(
  workspaceId: string,
  userId: string,
  kbIds?: string[]
) {
  const all = await listBasesForWorkspace(workspaceId);
  const pre = visibleBaseFilter(all, userId, kbIds);
  if (!pre.some((b) => b.accessMode === "teams")) return pre;
  const acc = await listEffectiveAccess(workspaceId, userId);
  if (!acc) return [];
  return pre.filter(
    (b) => resolveLevel(acc, "knowledge_base", b.id, b.accessMode) !== null
  );
}

/** Tool: list_workspace_knowledge_bases. */
export async function executeListWorkspaceKnowledgeBases(
  _input: Record<string, unknown>,
  userId?: string,
  _canvasContext?: unknown,
  workspaceId?: string,
  scopeFilters?: KnowledgeScopeFilters
): Promise<ToolResult> {
  if (!userId || !workspaceId) {
    return { result: JSON.stringify({ error: "Not authenticated." }) };
  }
  const visible = await listVisibleBases(workspaceId, userId, scopeFilters?.kbIds);
  return {
    result: JSON.stringify({
      knowledge_bases: visible.map((b) => ({
        id: b.id,
        slug: b.slug,
        name: b.name,
        description: b.description,
        visibility: b.visibility,
      })),
    }),
  };
}

/**
 * Tool: search_workspace_knowledge — full-text search across the
 * workspace's knowledge_entries.
 *
 * Implementation: relies on the existing fulltext index introduced in
 * `20260501020000_knowledge_fulltext.sql`. We use Supabase's
 * `textSearch()` with `english` dictionary. Falls back to ilike if the
 * tsvector column is empty for some reason.
 */
export async function executeSearchWorkspaceKnowledge(
  input: Record<string, unknown>,
  userId?: string,
  _canvasContext?: unknown,
  workspaceId?: string,
  scopeFilters?: KnowledgeScopeFilters
): Promise<ToolResult> {
  if (!userId || !workspaceId) {
    return { result: JSON.stringify({ error: "Not authenticated." }) };
  }
  const query = (input.query as string)?.trim();
  const maxResults = (input.max_results as number) || 8;
  if (!query) {
    return { result: JSON.stringify({ error: "query (string) is required" }) };
  }

  // Resolve visible bases, then constrain entry search to those.
  const visible = await listVisibleBases(workspaceId, userId, scopeFilters?.kbIds);
  if (visible.length === 0) {
    return { result: JSON.stringify({ matches: [] }) };
  }
  const visibleIds = visible.map((b) => b.id);
  const baseNameById = new Map(visible.map((b) => [b.id, b.name]));

  // ilike fallback — simple and predictable. The fulltext index can be
  // wired in later via an RPC if precision matters; for v1 the user is
  // typing short queries against their own KBs and the result set is
  // small.
  const pattern = `%${query.replace(/[%_]/g, "\\$&")}%`;
  const { data, error } = await supabase
    .from("knowledge_entries")
    .select(
      "id, knowledge_base_id, folder_id, title, excerpt, body, updated_at"
    )
    .eq("workspace_id", workspaceId)
    .in("knowledge_base_id", visibleIds)
    .is("deleted_at", null)
    .or(`title.ilike.${pattern},excerpt.ilike.${pattern},body.ilike.${pattern}`)
    .order("updated_at", { ascending: false })
    .limit(maxResults);
  if (error) {
    return { result: JSON.stringify({ error: error.message }) };
  }

  const matches = (data ?? []).map((row) => {
    const body = (row.body as string) ?? "";
    const lower = body.toLowerCase();
    const idx = lower.indexOf(query.toLowerCase());
    const start = Math.max(0, idx - 80);
    const snippet =
      idx >= 0
        ? body.slice(start, Math.min(body.length, idx + 200))
        : (row.excerpt as string) ?? body.slice(0, 200);
    return {
      entry_id: row.id,
      knowledge_base: baseNameById.get(row.knowledge_base_id as string) ?? "",
      title: row.title,
      excerpt: row.excerpt,
      snippet,
    };
  });

  return { result: JSON.stringify({ matches }) };
}

/** Tool: read_knowledge_entry — return full body of one workspace KB entry. */
export async function executeReadKnowledgeEntry(
  input: Record<string, unknown>,
  userId?: string,
  _canvasContext?: unknown,
  workspaceId?: string,
  scopeFilters?: KnowledgeScopeFilters
): Promise<ToolResult> {
  if (!userId || !workspaceId) {
    return { result: JSON.stringify({ error: "Not authenticated." }) };
  }
  const entryId = input.entry_id as string;
  const slugInput = input.knowledge_base_slug as string | undefined;
  if (!entryId && !slugInput) {
    return {
      result: JSON.stringify({
        error: "Provide entry_id, or knowledge_base_slug + title.",
      }),
    };
  }

  if (entryId) {
    const entry = await findEntryById(entryId);
    if (!entry || entry.workspaceId !== workspaceId) {
      return { result: JSON.stringify({ error: "Entry not found." }) };
    }
    const visible = await listVisibleBases(workspaceId, userId, scopeFilters?.kbIds);
    const base = visible.find((b) => b.id === entry.knowledgeBaseId);
    if (!base) {
      return { result: JSON.stringify({ error: "Entry not visible." }) };
    }
    return {
      result: JSON.stringify({
        entry: {
          id: entry.id,
          knowledge_base: base.name,
          title: entry.title,
          excerpt: entry.excerpt,
          body: entry.body,
          updated_at: entry.updatedAt,
        },
      }),
    };
  }

  // slug + title fallback (let the model address by name).
  const titleInput = input.title as string | undefined;
  if (!slugInput || !titleInput) {
    return {
      result: JSON.stringify({
        error: "knowledge_base_slug AND title are required when entry_id is omitted.",
      }),
    };
  }
  const base = await findBaseBySlug(workspaceId, slugInput);
  if (!base) {
    return { result: JSON.stringify({ error: "Knowledge base not found." }) };
  }
  if (base.visibility === "private" && base.createdBy !== userId) {
    return { result: JSON.stringify({ error: "Knowledge base not visible." }) };
  }
  if (base.accessMode === "teams") {
    const level = await effectiveResourceAccess(
      userId,
      workspaceId,
      "knowledge_base",
      base.id
    );
    if (level === null) {
      return { result: JSON.stringify({ error: "Knowledge base not visible." }) };
    }
  }
  const entries = await listEntriesForBase(base.id);
  const match = entries.find(
    (e) => e.title.toLowerCase() === titleInput.toLowerCase()
  );
  if (!match) {
    return { result: JSON.stringify({ error: "Entry not found by title." }) };
  }
  return {
    result: JSON.stringify({
      entry: {
        id: match.id,
        knowledge_base: base.name,
        title: match.title,
        excerpt: match.excerpt,
        body: match.body,
        updated_at: match.updatedAt,
      },
    }),
  };
}
