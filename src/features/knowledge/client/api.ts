"use client";

/**
 * Typed client wrappers for knowledge REST endpoints. Each sets
 * `X-Workspace-Id` when `workspaceId` is given, throws `KnowledgeApiError` on
 * `!res.ok`, and returns JSON for 200/201 or `void` for 204.
 */
import { ApiError, apiRequest } from "@/shared/api/api-client";
import type {
  ChannelGrantChannelRef,
  ChannelResourceGrant,
  KbShelf,
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
  /** URL search params (objects, never strings). */
  query?: Record<string, string | undefined>;
  /** Concurrency precondition, compared against the row's `updated_at`;
   *  mismatch → 412 `KNOWLEDGE_STALE_VERSION`. */
  expectedUpdatedAt?: string;
}

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  try {
    return await apiRequest<T>(path, opts);
  } catch (err) {
    if (err instanceof ApiError) {
      // re-type: doc-pane branches on KnowledgeApiError instances
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
  /** Foreign base owners' display names, keyed by user id. */
  ownerNames: Record<string, string>;
  /** Keyed by base id. A missing key means "unknown", never "empty": a base
   *  with no entries still gets a zeroed entry. */
  baseStats: Record<string, KnowledgeBaseStats>;
  /** Workspace per-base storage cap in bytes. `null` = unknown; meters are
   *  suppressed rather than drawn against a guessed cap. */
  kbStorageLimit: number | null;
  /** Caller's own starred base ids. Per-user favourite, not a base property,
   *  so it rides the response not the row. */
  starredBaseIds: string[];
  /**
   * Base ids granted into at least one channel — the set behind the card's
   * `Shared` pill. Read it with `?? EMPTY_SHARED` (INVARIANTS §8): this list is
   * IndexedDB-persisted, so an entry written before the key existed survives
   * the upgrade without it.
   */
  sharedBaseIds: string[];
  /** `{baseId → {level, guestWrite}}` for the channel passed as `channelId`.
   *  `EMPTY_GRANTS` when no channelId was requested or a pre-grant server sent
   *  no key. A base with no grant is simply absent from the map. */
  channelGrants: Record<string, ChannelResourceGrant>;
}

/** Shared frozen empty list — the §8 fallback for `sharedBaseIds`; a fresh `[]`
 *  per read would churn every memo keyed on it. */
export const EMPTY_SHARED: readonly string[] = Object.freeze([]);

/** Shared frozen empty map — §8 fallback for `channelGrants`, for the same
 *  memo-churn reason. */
export const EMPTY_GRANTS: Readonly<Record<string, ChannelResourceGrant>> =
  Object.freeze({});

export async function fetchBaseList(
  workspaceId?: string,
  /** When set, the request carries `?channelId=` and the response folds in the
   *  scope-A `channelGrants` map for that channel. */
  channelId?: string,
  /**
   * When set, the request carries `?shelf=` and the server returns only that
   * shelf's bases (`../types.ts › KbShelf`). Omitted is both shelves — this is
   * a narrowing, so forgetting it widens. Deliberately no client-side fallback
   * filter: the rows are meant not to arrive.
   */
  shelf?: KbShelf
): Promise<KnowledgeBaseList> {
  const data = await request<{
    bases: KnowledgeBase[];
    ownerNames?: Record<string, string>;
    baseStats?: Record<string, KnowledgeBaseStats>;
    kbStorageLimit?: number | null;
    starredBaseIds?: string[];
    sharedBaseIds?: string[];
    channelGrants?: Record<string, ChannelResourceGrant>;
  }>("/api/knowledge/bases", {
    workspaceId,
    // `withQuery` strips `undefined` values, so this object is safe to build
    // unconditionally — an absent channelId/shelf sends no param at all.
    query: channelId || shelf ? { channelId, shelf } : undefined,
  });
  return {
    bases: data.bases,
    ownerNames: data.ownerNames ?? {},
    baseStats: data.baseStats ?? {},
    // pre-deploy server sends no key — same answer as a failed read.
    kbStorageLimit: data.kbStorageLimit ?? null,
    starredBaseIds: data.starredBaseIds ?? [],
    sharedBaseIds: data.sharedBaseIds ?? [],
    // §8 stale-cache: a payload cached before this field existed carries no
    // `channelGrants` key; the fallback renders "no grants", never a blank pane.
    channelGrants: data.channelGrants ?? EMPTY_GRANTS,
  };
}

/**
 * Star/unstar one base for the calling user. Two idempotent verbs (PUT/DELETE),
 * not a toggle: the caller states the desired end state, so a retry after an
 * ambiguous failure cannot flip the value back.
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

/** `GET /api/knowledge/bases/{baseId}/channel-grants`. `channels` is the
 *  caller's server-fenced visible list; `grants` is keyed by channel id, absent
 *  when ungranted; `channelScopeAllowed` is whether this container lends into
 *  channels at all (`shared/tenancy/channel-scope.ts`). */
export interface ChannelGrantSettings {
  /** Creator or workspace admin+. False renders the read-only summary. */
  canManage: boolean;
  channelScopeAllowed: boolean;
  channels: ChannelGrantChannelRef[];
  grants: Record<string, ChannelResourceGrant>;
}

export async function fetchChannelGrants(
  baseId: string,
  workspaceId?: string
): Promise<ChannelGrantSettings> {
  const data = await request<{
    canManage?: boolean;
    channelScopeAllowed?: boolean;
    channels?: ChannelGrantChannelRef[];
    grants?: Record<string, ChannelResourceGrant>;
  }>(`/api/knowledge/bases/${baseId}/channel-grants`, { workspaceId });
  return {
    // §8 stale-cache / old-server read: every field falls back closed —
    // read-only, no channels, no channel section.
    canManage: data.canManage ?? false,
    channelScopeAllowed: data.channelScopeAllowed ?? false,
    channels: data.channels ?? [],
    grants: data.grants ?? {},
  };
}

/**
 * Set one (KB, channel) grant. `level: "none"` un-shares; the response's
 * `grant` is then `null`, which the cache patch reads as "remove the key".
 * Idempotent PUT stating the end state, not a toggle — a retry after an
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
 * Download base/folder as zip, or a single entry as `.md`. Honors the routes'
 * `Content-Disposition` filename, else a default.
 * `fetch` + object-URL anchor, not a plain link: the link form drops
 * `X-Workspace-Id`, so the caller resolves somewhere it did not ask for, or
 * navigates to an error page instead of surfacing `KnowledgeApiError`.
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
      // non-JSON error body — keep the status text.
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
