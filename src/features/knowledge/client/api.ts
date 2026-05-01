"use client";

/**
 * Typed client wrappers for the knowledge REST endpoints (Item 2).
 *
 * Every function here is a thin shell around `fetch` that:
 *   - Sets the `X-Workspace-Id` header when a `workspaceId` is provided.
 *   - Throws `KnowledgeApiError` on `!res.ok` so callers can `try/catch`
 *     uniformly. The error carries the HTTP status, code, and message
 *     pulled from the `{ error: { code, message } }` envelope returned
 *     by `toKnowledgeErrorResponse`.
 *   - Returns the parsed JSON body for 200/201, or `void` for 204.
 *
 * Conventions match the route handlers in `src/app/api/knowledge/`.
 */
import type {
  KnowledgeBase,
  KnowledgeFolder,
  KnowledgeEntry,
} from "@/features/knowledge/types";
import type {
  KnowledgeBaseCreateInput,
  KnowledgeBaseUpdateInput,
  KnowledgeFolderCreateInput,
  KnowledgeFolderUpdateInput,
  KnowledgeFolderMoveInput,
  KnowledgeEntryCreateInput,
  KnowledgeEntryUpdateInput,
  KnowledgeEntryMoveInput,
} from "@/features/knowledge/schema";

// ─── Error type ─────────────────────────────────────────────────────

export class KnowledgeApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "KnowledgeApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// ─── Internal request helper ────────────────────────────────────────

interface RequestOpts {
  workspaceId?: string;
  body?: unknown;
  /** Defaults to GET. */
  method?: "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
  /** Optional URL search params (objects, never strings). */
  query?: Record<string, string | undefined>;
  /**
   * Optional concurrency precondition. When set, the server compares
   * against the row's current `updated_at` and returns 412
   * `KNOWLEDGE_STALE_VERSION` on mismatch. Item 5.A.3.
   */
  expectedUpdatedAt?: string;
}

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.workspaceId) headers["x-workspace-id"] = opts.workspaceId;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.expectedUpdatedAt) headers["x-updated-at"] = opts.expectedUpdatedAt;

  const url = new URL(path, window.location.origin);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: "same-origin",
  });

  if (res.status === 204) return undefined as T;

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    if (!res.ok) {
      throw new KnowledgeApiError(res.status, "INTERNAL_ERROR", res.statusText);
    }
    return undefined as T;
  }

  if (!res.ok) {
    const env = parsed as { error?: { code?: string; message?: string; details?: unknown } };
    const code = env.error?.code ?? "INTERNAL_ERROR";
    const message = env.error?.message ?? res.statusText;
    throw new KnowledgeApiError(res.status, code, message, env.error?.details);
  }

  return parsed as T;
}

// ─── Bases ──────────────────────────────────────────────────────────

export async function fetchBases(workspaceId?: string): Promise<KnowledgeBase[]> {
  const data = await request<{ bases: KnowledgeBase[] }>("/api/knowledge/bases", {
    workspaceId,
  });
  return data.bases;
}

export async function fetchBase(
  baseId: string,
  workspaceId?: string
): Promise<KnowledgeBase> {
  const data = await request<{ base: KnowledgeBase }>(
    `/api/knowledge/bases/${baseId}`,
    { workspaceId }
  );
  return data.base;
}

export async function fetchTree(
  baseId: string,
  workspaceId?: string
): Promise<{ base: KnowledgeBase; folders: KnowledgeFolder[]; entries: KnowledgeEntry[] }> {
  return request(`/api/knowledge/bases/${baseId}/tree`, { workspaceId });
}

export async function createBase(
  input: KnowledgeBaseCreateInput,
  workspaceId?: string
): Promise<KnowledgeBase> {
  const data = await request<{ base: KnowledgeBase }>("/api/knowledge/bases", {
    method: "POST",
    body: input,
    workspaceId,
  });
  return data.base;
}

export async function updateBase(
  baseId: string,
  patch: KnowledgeBaseUpdateInput,
  workspaceId?: string
): Promise<KnowledgeBase> {
  const data = await request<{ base: KnowledgeBase }>(
    `/api/knowledge/bases/${baseId}`,
    { method: "PATCH", body: patch, workspaceId }
  );
  return data.base;
}

export async function deleteBase(
  baseId: string,
  workspaceId?: string
): Promise<void> {
  await request<void>(`/api/knowledge/bases/${baseId}`, {
    method: "DELETE",
    workspaceId,
  });
}

export async function restoreBase(
  baseId: string,
  workspaceId?: string
): Promise<KnowledgeBase> {
  const data = await request<{ base: KnowledgeBase }>(
    `/api/knowledge/bases/${baseId}/restore`,
    { method: "POST", workspaceId }
  );
  return data.base;
}

// ─── Folders ────────────────────────────────────────────────────────

export async function fetchFolders(
  baseId: string,
  workspaceId?: string
): Promise<KnowledgeFolder[]> {
  const data = await request<{ folders: KnowledgeFolder[] }>(
    `/api/knowledge/bases/${baseId}/folders`,
    { workspaceId }
  );
  return data.folders;
}

export type FolderCreateBody = Omit<KnowledgeFolderCreateInput, "knowledgeBaseId">;

export async function createFolder(
  baseId: string,
  body: FolderCreateBody,
  workspaceId?: string
): Promise<KnowledgeFolder> {
  const data = await request<{ folder: KnowledgeFolder }>(
    `/api/knowledge/bases/${baseId}/folders`,
    { method: "POST", body, workspaceId }
  );
  return data.folder;
}

export async function updateFolder(
  folderId: string,
  patch: KnowledgeFolderUpdateInput,
  workspaceId?: string,
  expectedUpdatedAt?: string
): Promise<KnowledgeFolder> {
  const data = await request<{ folder: KnowledgeFolder }>(
    `/api/knowledge/folders/${folderId}`,
    { method: "PATCH", body: patch, workspaceId, expectedUpdatedAt }
  );
  return data.folder;
}

export async function deleteFolder(
  folderId: string,
  workspaceId?: string
): Promise<void> {
  await request<void>(`/api/knowledge/folders/${folderId}`, {
    method: "DELETE",
    workspaceId,
  });
}

export async function moveFolder(
  folderId: string,
  input: KnowledgeFolderMoveInput,
  workspaceId?: string
): Promise<KnowledgeFolder> {
  const data = await request<{ folder: KnowledgeFolder }>(
    `/api/knowledge/folders/${folderId}/move`,
    { method: "POST", body: input, workspaceId }
  );
  return data.folder;
}

export async function restoreFolder(
  folderId: string,
  workspaceId?: string
): Promise<KnowledgeFolder> {
  const data = await request<{ folder: KnowledgeFolder }>(
    `/api/knowledge/folders/${folderId}/restore`,
    { method: "POST", workspaceId }
  );
  return data.folder;
}

// ─── Entries ────────────────────────────────────────────────────────

export interface FetchEntriesOpts {
  folderId?: string | null;
  includeBody?: boolean;
}

export async function fetchEntries(
  baseId: string,
  opts: FetchEntriesOpts = {},
  workspaceId?: string
): Promise<KnowledgeEntry[]> {
  const query: Record<string, string | undefined> = {};
  if (opts.folderId !== undefined) {
    query.folderId = opts.folderId === null ? "null" : opts.folderId;
  }
  if (opts.includeBody === false) query.includeBody = "false";
  const data = await request<{ entries: KnowledgeEntry[] }>(
    `/api/knowledge/bases/${baseId}/entries`,
    { workspaceId, query }
  );
  return data.entries;
}

export async function fetchEntry(
  entryId: string,
  workspaceId?: string
): Promise<KnowledgeEntry> {
  const data = await request<{ entry: KnowledgeEntry }>(
    `/api/knowledge/entries/${entryId}`,
    { workspaceId }
  );
  return data.entry;
}

export type EntryCreateBody = Omit<KnowledgeEntryCreateInput, "knowledgeBaseId">;

export async function createEntry(
  baseId: string,
  body: EntryCreateBody,
  workspaceId?: string
): Promise<KnowledgeEntry> {
  const data = await request<{ entry: KnowledgeEntry }>(
    `/api/knowledge/bases/${baseId}/entries`,
    { method: "POST", body, workspaceId }
  );
  return data.entry;
}

export async function updateEntry(
  entryId: string,
  patch: KnowledgeEntryUpdateInput,
  workspaceId?: string,
  expectedUpdatedAt?: string
): Promise<KnowledgeEntry> {
  const data = await request<{ entry: KnowledgeEntry }>(
    `/api/knowledge/entries/${entryId}`,
    { method: "PATCH", body: patch, workspaceId, expectedUpdatedAt }
  );
  return data.entry;
}

export async function deleteEntry(
  entryId: string,
  workspaceId?: string
): Promise<void> {
  await request<void>(`/api/knowledge/entries/${entryId}`, {
    method: "DELETE",
    workspaceId,
  });
}

export async function moveEntry(
  entryId: string,
  input: KnowledgeEntryMoveInput,
  workspaceId?: string
): Promise<KnowledgeEntry> {
  const data = await request<{ entry: KnowledgeEntry }>(
    `/api/knowledge/entries/${entryId}/move`,
    { method: "POST", body: input, workspaceId }
  );
  return data.entry;
}

export async function restoreEntry(
  entryId: string,
  workspaceId?: string
): Promise<KnowledgeEntry> {
  const data = await request<{ entry: KnowledgeEntry }>(
    `/api/knowledge/entries/${entryId}/restore`,
    { method: "POST", workspaceId }
  );
  return data.entry;
}

// ─── Trash ──────────────────────────────────────────────────────────

export async function fetchTrash(
  baseId?: string,
  workspaceId?: string
): Promise<{ bases: KnowledgeBase[]; folders: KnowledgeFolder[]; entries: KnowledgeEntry[] }> {
  return request("/api/knowledge/trash", {
    workspaceId,
    query: { baseId },
  });
}

export async function purgeTrash(
  beforeIso: string,
  workspaceId?: string
): Promise<{ deleted: number }> {
  return request("/api/knowledge/trash/purge", {
    method: "POST",
    body: { beforeIso },
    workspaceId,
  });
}

// ─── Search (Item 5.D) ──────────────────────────────────────────────

export interface KnowledgeSearchHit {
  entryId: string;
  knowledgeBaseId: string;
  folderId: string | null;
  title: string;
  excerpt: string | null;
  /** Snippet has `<b>` tags around matched terms — strip or render. */
  snippet: string;
  rank: number;
  updatedAt: string;
}

export async function searchKnowledge(
  query: string,
  opts: { baseSlug?: string; limit?: number } = {},
  workspaceId?: string
): Promise<KnowledgeSearchHit[]> {
  const data = await request<{ hits: KnowledgeSearchHit[] }>(
    "/api/knowledge/search",
    {
      workspaceId,
      query: {
        q: query,
        base: opts.baseSlug,
        limit: opts.limit !== undefined ? String(opts.limit) : undefined,
      },
    }
  );
  return data.hits;
}
