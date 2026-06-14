import "server-only";
import { randomUUID } from "crypto";
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

/** Minimal shapes the resolver returns; both read + render tools use them. */
type ResolvedEntry = {
  id: string;
  title: string;
  excerpt: string | null;
  body: string;
  updatedAt: string | null;
};
type ResolvedBase = { id: string; slug: string; name: string };

/**
 * Resolve one visible KB entry from a tool input — by `entry_id`
 * (preferred) or `knowledge_base_slug` + `title`. Centralises the
 * access checks (private ownership + teams-mode grant) so the read and
 * render tools enforce the exact same visibility rules. Returns the
 * entry + its owning base, or a user-facing `error` string.
 */
async function resolveVisibleEntry(
  input: Record<string, unknown>,
  userId: string,
  workspaceId: string,
  scopeFilters?: KnowledgeScopeFilters
): Promise<{ entry: ResolvedEntry; base: ResolvedBase } | { error: string }> {
  const entryId = input.entry_id as string | undefined;
  const slugInput = input.knowledge_base_slug as string | undefined;
  if (!entryId && !slugInput) {
    return { error: "Provide entry_id, or knowledge_base_slug + title." };
  }

  if (entryId) {
    const entry = await findEntryById(entryId);
    if (!entry || entry.workspaceId !== workspaceId) {
      return { error: "Entry not found." };
    }
    const visible = await listVisibleBases(workspaceId, userId, scopeFilters?.kbIds);
    const base = visible.find((b) => b.id === entry.knowledgeBaseId);
    if (!base) return { error: "Entry not visible." };
    return {
      entry: {
        id: entry.id,
        title: entry.title,
        excerpt: entry.excerpt,
        body: entry.body,
        updatedAt: entry.updatedAt,
      },
      base: { id: base.id, slug: base.slug, name: base.name },
    };
  }

  // slug + title fallback (let the model address by name).
  const titleInput = input.title as string | undefined;
  if (!slugInput || !titleInput) {
    return {
      error:
        "knowledge_base_slug AND title are required when entry_id is omitted.",
    };
  }
  const base = await findBaseBySlug(workspaceId, slugInput);
  if (!base) return { error: "Knowledge base not found." };
  if (base.visibility === "private" && base.createdBy !== userId) {
    return { error: "Knowledge base not visible." };
  }
  // Respect the per-chat scope picker when it's narrowing to a subset.
  if (scopeFilters?.kbIds && !scopeFilters.kbIds.includes(base.id)) {
    return { error: "Knowledge base not in scope." };
  }
  if (base.accessMode === "teams") {
    const level = await effectiveResourceAccess(
      userId,
      workspaceId,
      "knowledge_base",
      base.id
    );
    if (level === null) return { error: "Knowledge base not visible." };
  }
  const entries = await listEntriesForBase(base.id);
  const match = entries.find(
    (e) => e.title.toLowerCase() === titleInput.toLowerCase()
  );
  if (!match) return { error: "Entry not found by title." };
  return {
    entry: {
      id: match.id,
      title: match.title,
      excerpt: match.excerpt,
      body: match.body,
      updatedAt: match.updatedAt,
    },
    base: { id: base.id, slug: base.slug, name: base.name },
  };
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
  const resolved = await resolveVisibleEntry(
    input,
    userId,
    workspaceId,
    scopeFilters
  );
  if ("error" in resolved) {
    return { result: JSON.stringify({ error: resolved.error }) };
  }
  const { entry, base } = resolved;
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

/**
 * Tool: render_knowledge_entry — surface one entry as a faithful inline
 * document card in the chat.
 *
 * Fetches the REAL entry under the caller's access (same resolver as the
 * read tool) and returns a `kb_card` artifact carrying the true body, so
 * the rendered card can never be a model hallucination. The model-facing
 * `result` is intentionally small (title + KB only, NOT the body): the
 * card shows the content, so re-dumping the body into the conversation
 * would just burn tokens.
 */
export async function executeRenderKnowledgeEntry(
  input: Record<string, unknown>,
  userId?: string,
  _canvasContext?: unknown,
  workspaceId?: string,
  scopeFilters?: KnowledgeScopeFilters
): Promise<ToolResult> {
  if (!userId || !workspaceId) {
    return { result: JSON.stringify({ error: "Not authenticated." }) };
  }
  const resolved = await resolveVisibleEntry(
    input,
    userId,
    workspaceId,
    scopeFilters
  );
  if ("error" in resolved) {
    return { result: JSON.stringify({ error: resolved.error }) };
  }
  const { entry, base } = resolved;
  return {
    result: JSON.stringify({
      status: "rendered",
      kind: "kb_card",
      title: entry.title,
      knowledge_base: base.name,
    }),
    artifact: {
      kind: "kb_card",
      id: randomUUID(),
      title: entry.title,
      knowledgeBase: base.name,
      knowledgeBaseSlug: base.slug,
      body: entry.body,
      entryId: entry.id,
      updatedAt: entry.updatedAt,
    },
  };
}
