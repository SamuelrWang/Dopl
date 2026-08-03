"use client";

/**
 * Client data hooks for the knowledge API, backed by TanStack Query
 * (ENGINEERING §7). The old hand-rolled `useFetch` + module-level
 * memoryCache are gone — the query cache supplies warm-start on
 * remount, request dedupe, and stale-while-revalidate.
 *
 * Return shape is the original `Result<T>` contract (the frozen canvas
 * panels consume `{ data, status, error, refetch }` — keep it stable):
 * status `idle | loading | success | error`, error typed as
 * `KnowledgeApiError`, `data` kept while a same-key refetch is in
 * flight (no flicker), cleared on key change (no cross-workspace leak).
 */
import { useCallback, useMemo } from "react";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import type {
  KnowledgeBase,
  KnowledgeEntry,
  KnowledgeFolder,
} from "@/features/knowledge/types";
import {
  KnowledgeApiError,
  fetchBaseList,
  fetchEntry,
  fetchTree,
  type KnowledgeBaseList,
} from "./api";

export type FetchStatus = "idle" | "loading" | "success" | "error";

interface Result<T> {
  data: T | null;
  error: KnowledgeApiError | null;
  status: FetchStatus;
  refetch: () => void;
}

/**
 * Optional SSR seed. When the parent has already loaded the data on the
 * server (e.g. a Next.js server component fetched the first entry), it
 * can pass it in to skip the initial client-side fetch. Applied only
 * when the seed's key matches the hook's current key.
 */
interface UseFetchOptions<T> {
  initialData?: T;
  initialKey?: string;
}

function toApiError(err: unknown): KnowledgeApiError {
  if (err instanceof KnowledgeApiError) return err;
  return new KnowledgeApiError(
    500,
    "INTERNAL_ERROR",
    err instanceof Error ? err.message : "Unknown error"
  );
}

function useKnowledgeQuery<T>(
  key: string | null,
  loader: () => Promise<T>,
  options?: UseFetchOptions<T>
): Result<T> {
  const query = useQuery({
    queryKey: ["knowledge", key],
    queryFn: () => loader().catch((err: unknown) => Promise.reject(toApiError(err))),
    enabled: key !== null,
    initialData:
      options?.initialData !== undefined && options.initialKey === key
        ? options.initialData
        : undefined,
  });

  // Data wins over error: a failed BACKGROUND refetch (focus/reconnect)
  // must not blank already-rendered content into an error card. "error"
  // is only reachable while there is nothing to show.
  const status: FetchStatus =
    key === null
      ? "idle"
      : query.data !== undefined
        ? "success"
        : query.error
          ? "error"
          : "loading";

  // v5 refetch() ignores `enabled` — a null-key hook would fire a real
  // request at a garbage URL (e.g. /api/knowledge/entries/null from the
  // controller's unconditional realtime refetch). No-op while idle.
  const rawRefetch = query.refetch;
  const refetch = useCallback(() => {
    if (key !== null) void rawRefetch();
  }, [key, rawRefetch]);

  return {
    data: query.data ?? null,
    error: query.error ? toApiError(query.error) : null,
    status,
    refetch,
  };
}

// ─── Hooks ──────────────────────────────────────────────────────────

/**
 * The base list AND the owner-name map, in one cache entry.
 *
 * `GET /api/knowledge/bases` answers both halves in a single response, so
 * they share one key: a page that needs `ownerNames` (the desktop SPA's
 * knowledge page, which has no RSC to compute them) and the two-pane
 * controller's `useKnowledgeBases` ride the same request instead of hitting
 * the route twice.
 */
export function useKnowledgeBaseList(
  workspaceId?: string,
  options?: { initialData?: KnowledgeBaseList }
): Result<KnowledgeBaseList> {
  // Use the workspace id as the cache key so switching workspaces
  // re-fetches. Fall back to a sentinel so the hook still fires when
  // no id is provided (a sole-workspace caller auto-targets; a
  // multi-workspace one fails closed as WORKSPACE_REQUIRED). An optional
  // SSR seed avoids a skeleton flash when the page already loaded the
  // list on the server (mirrors useKnowledgeEntry's initialData).
  const key = `bases:${workspaceId ?? "default"}`;
  return useKnowledgeQuery<KnowledgeBaseList>(
    key,
    () => fetchBaseList(workspaceId),
    options?.initialData !== undefined
      ? { initialData: options.initialData, initialKey: key }
      : undefined
  );
}

/** The cache key `useKnowledgeBaseList`/`useKnowledgeBases` share. */
export function knowledgeBasesQueryKey(workspaceId?: string) {
  return ["knowledge", `bases:${workspaceId ?? "default"}`] as const;
}

/**
 * Upsert one base into the cached list, synchronously.
 *
 * Call this BEFORE navigating to a base the caller just created or renamed.
 * The URL is the only channel that carries a selection between the dialogs
 * and the two-pane controller, and the controller resolves a URL segment
 * against this list — so navigating first and refetching after leaves a
 * window where the segment matches nothing and the move is silently dropped.
 */
export function seedKnowledgeBase(
  queryClient: QueryClient,
  workspaceId: string | undefined,
  base: KnowledgeBase
): void {
  queryClient.setQueryData<KnowledgeBaseList>(
    knowledgeBasesQueryKey(workspaceId),
    (prev) => {
      if (!prev) return prev;
      const known = prev.bases.some((b) => b.id === base.id);
      return {
        ...prev,
        bases: known
          ? prev.bases.map((b) => (b.id === base.id ? base : b))
          : [base, ...prev.bases],
      };
    }
  );
}

export function useKnowledgeBases(
  workspaceId?: string,
  options?: { initialData?: KnowledgeBase[] }
): Result<KnowledgeBase[]> {
  const seed = options?.initialData;
  const list = useKnowledgeBaseList(
    workspaceId,
    // An SSR seed carries the bases only; `ownerNames` reaches the web page
    // as its own RSC prop, so an empty map here is the honest value and no
    // consumer reads it off this seeded entry.
    seed !== undefined ? { initialData: { bases: seed, ownerNames: {} } } : undefined
  );
  return useMemo(
    () => ({ ...list, data: list.data ? list.data.bases : null }),
    [list]
  );
}

export function useKnowledgeTree(
  baseId: string | null | undefined,
  workspaceId?: string
): Result<{
  base: KnowledgeBase;
  folders: KnowledgeFolder[];
  entries: KnowledgeEntry[];
}> {
  return useKnowledgeQuery(
    baseId ? `tree:${workspaceId ?? "default"}:${baseId}` : null,
    () => fetchTree(baseId as string, workspaceId)
  );
}

export function useKnowledgeEntry(
  entryId: string | null | undefined,
  workspaceId?: string,
  options?: { initialData?: KnowledgeEntry; initialEntryId?: string }
): Result<KnowledgeEntry> {
  const key = entryId ? `entry:${workspaceId ?? "default"}:${entryId}` : null;
  const initialKey =
    options?.initialEntryId !== undefined
      ? `entry:${workspaceId ?? "default"}:${options.initialEntryId}`
      : undefined;
  return useKnowledgeQuery(
    key,
    () => fetchEntry(entryId as string, workspaceId),
    { initialData: options?.initialData, initialKey }
  );
}
