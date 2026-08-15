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
import { ApiError, apiRequest } from "@/shared/api/api-client";
import type {
  KnowledgeBase,
  KnowledgeBaseStats,
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
  try {
    return await apiRequest<T>(path, opts);
  } catch (err) {
    if (err instanceof ApiError) {
      // Re-type onto the feature error — doc-pane branches on
      // KnowledgeApiError instances (e.g. 412 KNOWLEDGE_STALE_VERSION).
      throw new KnowledgeApiError(err.status, err.code, err.message, err.details);
    }
    throw err;
  }
}

// ─── Bases ──────────────────────────────────────────────────────────

/** `GET /api/knowledge/bases` in full: the list plus the two maps the route
 *  folds in — display names for bases created by *other* members, and the
 *  per-base counters the home grid renders. */
export interface KnowledgeBaseList {
  bases: KnowledgeBase[];
  /** Display names for foreign base owners, keyed by user id. `{}` when
   *  every visible base is the caller's own. */
  ownerNames: Record<string, string>;
  /** `{entryCount, lastEntryUpdatedAt, storageBytes}` keyed by base id. `{}`
   *  only when the route degraded — a base with no entries still gets a zeroed
   *  entry, so a MISSING key means "unknown", never "empty". */
  baseStats: Record<string, KnowledgeBaseStats>;
  /** The workspace's per-base storage cap in bytes, from its
   *  entitlement-resolved plan. `null` = unknown (an old server, or a failed
   *  billing read) — the meters are suppressed rather than drawn against a
   *  guessed cap. */
  kbStorageLimit: number | null;
  /** The CALLER'S OWN starred base ids, always a subset of `bases`. Per-user:
   *  a favourite, not a property of the base, so it rides the response rather
   *  than the row. `[]` is a real answer (nothing starred) AND the degraded
   *  one — an unknown star and no star render identically, so there is no
   *  third value to carry. */
  starredBaseIds: string[];
}

export async function fetchBaseList(
  workspaceId?: string
): Promise<KnowledgeBaseList> {
  const data = await request<{
    bases: KnowledgeBase[];
    ownerNames?: Record<string, string>;
    baseStats?: Record<string, KnowledgeBaseStats>;
    kbStorageLimit?: number | null;
    starredBaseIds?: string[];
  }>("/api/knowledge/bases", { workspaceId });
  return {
    bases: data.bases,
    ownerNames: data.ownerNames ?? {},
    baseStats: data.baseStats ?? {},
    // `?? null` covers the pre-deploy server that does not send the key at all
    // — indistinguishable, correctly, from a server that could not resolve it.
    kbStorageLimit: data.kbStorageLimit ?? null,
    // A server that predates stars sends no key; `[]` renders as "nothing
    // starred", which is exactly what such a server means.
    starredBaseIds: data.starredBaseIds ?? [],
  };
}

/**
 * Star or unstar ONE base for the calling user.
 *
 * Two idempotent verbs rather than a toggle, matching the route: the caller
 * states the end state it wants, so a retry after an ambiguous failure cannot
 * flip the value back. Returns nothing worth reading — the client already knows
 * the end state it asked for, and reconciling against an echo of its own
 * argument would only add a way for the two to disagree.
 */
export async function setBaseStar(
  baseId: string,
  starred: boolean,
  workspaceId?: string
): Promise<void> {
  await request<{ starred: boolean }>(`/api/knowledge/bases/${baseId}/star`, {
    method: starred ? "PUT" : "DELETE",
    workspaceId,
  });
}

export async function fetchBases(workspaceId?: string): Promise<KnowledgeBase[]> {
  const { bases } = await fetchBaseList(workspaceId);
  return bases;
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
  workspaceId?: string,
  expectedUpdatedAt?: string
): Promise<KnowledgeBase> {
  const data = await request<{ base: KnowledgeBase }>(
    `/api/knowledge/bases/${baseId}`,
    { method: "PATCH", body: patch, workspaceId, expectedUpdatedAt }
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

// ─── Folders ────────────────────────────────────────────────────────

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

// ─── Entries ────────────────────────────────────────────────────────

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

// ─── Export / download ──────────────────────────────────────────────

export type KnowledgeExportKind = "base" | "folder" | "entry";

/**
 * Downloads a base/folder as a zip or a single entry as a `.md` file.
 * The export routes return a blob with a `Content-Disposition`
 * filename; we honor it, falling back to a sensible default. The
 * workspace header is sent so the right workspace is targeted (without
 * it a multi-workspace caller fails closed as WORKSPACE_REQUIRED).
 *
 * Done with `fetch` + an object-URL anchor rather than a plain link so
 * the `X-Workspace-Id` header rides along and HTTP errors surface as
 * `KnowledgeApiError` instead of navigating to an error page.
 */
export async function downloadKnowledgeExport(
  kind: KnowledgeExportKind,
  id: string,
  workspaceId?: string
): Promise<void> {
  const path =
    kind === "base"
      ? `/api/knowledge/bases/${id}/export`
      : kind === "folder"
        ? `/api/knowledge/folders/${id}/export`
        : `/api/knowledge/entries/${id}/export`;

  const headers: Record<string, string> = {};
  if (workspaceId) headers["x-workspace-id"] = workspaceId;

  const res = await fetch(new URL(path, window.location.origin).toString(), {
    headers,
    credentials: "same-origin",
  });

  if (!res.ok) {
    let code = "INTERNAL_ERROR";
    let message = res.statusText;
    try {
      const env = (await res.json()) as { error?: { code?: string; message?: string } };
      code = env.error?.code ?? code;
      message = env.error?.message ?? message;
    } catch {
      // Non-JSON error body — keep the status text.
    }
    throw new KnowledgeApiError(res.status, code, message);
  }

  const blob = await res.blob();
  const fallback = kind === "entry" ? "entry.md" : "knowledge.zip";
  const filename = filenameFromDisposition(res.headers.get("content-disposition")) ?? fallback;
  triggerBlobDownload(blob, filename);
}

function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const match = /filename="?([^"]+)"?/i.exec(header);
  return match ? match[1] : null;
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
