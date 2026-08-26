"use client";

/**
 * Typed client wrappers for knowledge REST endpoints. Each sets
 * `X-Workspace-Id` when `workspaceId` given, throws `KnowledgeApiError` on
 * `!res.ok` (from `toKnowledgeErrorResponse`'s `{ error: { code, message } }`
 * envelope), returns JSON for 200/201 or `void` for 204. Conventions match
 * `src/app/api/knowledge/`.
 */
import { ApiError, apiRequest } from "@/shared/api/api-client";
import type {
  ChannelGrantChannelRef,
  ChannelResourceGrant,
  KnowledgeBase,
  KnowledgeBaseStats,
  KnowledgeFolder,
  KnowledgeEntry,
} from "@/features/knowledge/types";
import type {
  ChannelGrantWriteInput,
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
  /** Concurrency precondition. Server compares against the row's current
   *  `updated_at`; mismatch → 412 `KNOWLEDGE_STALE_VERSION`. */
  expectedUpdatedAt?: string;
}

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  try {
    return await apiRequest<T>(path, opts);
  } catch (err) {
    if (err instanceof ApiError) {
      // ⚠ Re-type: doc-pane branches on KnowledgeApiError instances
      // (e.g. 412 KNOWLEDGE_STALE_VERSION).
      throw new KnowledgeApiError(err.status, err.code, err.message, err.details);
    }
    throw err;
  }
}

// ─── Bases ──────────────────────────────────────────────────────────

/** Full `GET /api/knowledge/bases` response: list plus the maps the route folds in. */
export interface KnowledgeBaseList {
  bases: KnowledgeBase[];
  /** Foreign base owners' display names, keyed by user id. `{}` when every
   *  visible base is the caller's own. */
  ownerNames: Record<string, string>;
  /** Keyed by base id. ⚠ MISSING key means "unknown", never "empty" — a base
   *  with no entries still gets a zeroed entry; `{}` only when route degraded. */
  baseStats: Record<string, KnowledgeBaseStats>;
  /** Workspace per-base storage cap in bytes, from entitlement-resolved plan.
   *  `null` = unknown (old server, or failed billing read) — meters suppressed
   *  rather than drawn against a guessed cap. */
  kbStorageLimit: number | null;
  /** CALLER'S OWN starred base ids, subset of `bases`. Per-user favourite, not
   *  a base property, so it rides the response not the row. `[]` covers both
   *  "nothing starred" and degraded — both render identically. */
  starredBaseIds: string[];
  /** `{baseId → {level, guestWrite}}` for the channel passed as `channelId`.
   *  ⚠ `EMPTY_GRANTS` ({}) when NO channelId was requested OR a pre-grant server
   *  sent no key — both mean "no scope-A grants to show here", which renders
   *  identically. A base with no grant is simply ABSENT from the map. */
  channelGrants: Record<string, ChannelResourceGrant>;
}

/** Shared frozen empty map — a stale cached payload (no `channelGrants` key)
 *  and an unscoped read both fall back to THIS, never a fresh `{}` per read. */
export const EMPTY_GRANTS: Readonly<Record<string, ChannelResourceGrant>> =
  Object.freeze({});

export async function fetchBaseList(
  workspaceId?: string,
  /** When set, the request carries `?channelId=` and the response folds in the
   *  scope-A `channelGrants` map for that channel. */
  channelId?: string
): Promise<KnowledgeBaseList> {
  const data = await request<{
    bases: KnowledgeBase[];
    ownerNames?: Record<string, string>;
    baseStats?: Record<string, KnowledgeBaseStats>;
    kbStorageLimit?: number | null;
    starredBaseIds?: string[];
    channelGrants?: Record<string, ChannelResourceGrant>;
  }>("/api/knowledge/bases", {
    workspaceId,
    query: channelId ? { channelId } : undefined,
  });
  return {
    bases: data.bases,
    ownerNames: data.ownerNames ?? {},
    baseStats: data.baseStats ?? {},
    // Pre-deploy server sends no key — indistinguishable from one that
    // could not resolve it, correctly.
    kbStorageLimit: data.kbStorageLimit ?? null,
    starredBaseIds: data.starredBaseIds ?? [],
    // ⚠ §8 stale-cache: a payload cached before this field existed carries no
    // `channelGrants` key. `?? EMPTY_GRANTS` keeps the read from crashing and
    // renders "no grants", never a blank pane.
    channelGrants: data.channelGrants ?? EMPTY_GRANTS,
  };
}

/**
 * Star/unstar ONE base for the calling user. ⚠ Two idempotent verbs
 * (PUT/DELETE), not a toggle: caller states desired end state, so a retry
 * after an ambiguous failure cannot flip the value back.
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

// ─── Channel grants (scope-A sharing) ───────────────────────────────

/** `GET /api/knowledge/bases/{baseId}/channel-grants` — the settings section's
 *  read. `channels` is the caller's SERVER-fenced visible list; `grants` is
 *  keyed by channel id and a channel with no grant is ABSENT from it. */
export interface ChannelGrantSettings {
  /** Creator or workspace admin+. False renders the read-only summary. */
  canManage: boolean;
  channels: ChannelGrantChannelRef[];
  grants: Record<string, ChannelResourceGrant>;
}

export async function fetchChannelGrants(
  baseId: string,
  workspaceId?: string
): Promise<ChannelGrantSettings> {
  const data = await request<{
    canManage?: boolean;
    channels?: ChannelGrantChannelRef[];
    grants?: Record<string, ChannelResourceGrant>;
  }>(`/api/knowledge/bases/${baseId}/channel-grants`, { workspaceId });
  return {
    // ⚠ §8 stale-cache / old-server read: every field falls back to the
    // CLOSED value. An unknown `canManage` renders read-only, an unknown
    // channel list renders nothing — never an editor over invented rows.
    canManage: data.canManage ?? false,
    channels: data.channels ?? [],
    grants: data.grants ?? {},
  };
}

/**
 * Set ONE (KB, channel) grant. `level: "none"` un-shares; the response's
 * `grant` is `null` for it, which the cache patch reads as "remove the key".
 *
 * ⚠ ONE IDEMPOTENT PUT STATING THE END STATE, not a toggle — a retry after an
 * ambiguous failure cannot land the opposite of what the operator chose.
 */
export async function setChannelGrant(
  baseId: string,
  body: ChannelGrantWriteInput,
  workspaceId?: string
): Promise<ChannelResourceGrant | null> {
  const data = await request<{
    channelId: string;
    grant: ChannelResourceGrant | null;
  }>(`/api/knowledge/bases/${baseId}/channel-grants`, {
    method: "PUT",
    body,
    workspaceId,
  });
  return data.grant;
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
 * Download base/folder as zip, or single entry as `.md`. Honors the
 * routes' `Content-Disposition` filename, else a default.
 * ⚠ `fetch` + object-URL anchor, NOT a plain link: the link form drops
 * `X-Workspace-Id` (multi-workspace caller fails closed as
 * WORKSPACE_REQUIRED) and navigates to an error page instead of
 * surfacing `KnowledgeApiError`.
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

// ─── Search ─────────────────────────────────────────────────────────

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
