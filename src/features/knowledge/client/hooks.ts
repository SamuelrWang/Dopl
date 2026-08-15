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
import { useCallback } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
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
  setBaseStar,
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
 * controller ride the same request instead of hitting the route twice.
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

/** The cache key every reader and writer of the base list shares. */
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

/*
 * `useKnowledgeBases` — the bases-only projection of the list — was DELETED
 * 2026-08-12 when the controller started needing `starredBaseIds` off the same
 * entry and moved onto `useKnowledgeBaseList` directly. It had one caller. A
 * projection hook that drops four of the five keys is a trap on a response
 * that keeps growing folds: every new key needs a second reader, and the
 * second reader is a second render behind the first.
 */

/**
 * Toggle the caller's star on one base, OPTIMISTICALLY.
 *
 * The star rides the base-list cache entry (`starredBaseIds`), so the whole
 * write is a patch of that one key — which is what makes the grid reorder on
 * the click rather than on the round trip.
 *
 * WHY THIS IS HAND-ROLLED AND NOT `useApiMutation`. INVARIANTS §8 rule 6: a
 * feature's READS must be on `useApiQuery` before its WRITES adopt that layer,
 * and knowledge reads are not — they are on `useKnowledgeQuery` above, under
 * `["knowledge", key]` keys that `apiQueryKey` does not mint. Adopting the
 * write layer here would patch a key nothing is subscribed to and fail
 * SILENTLY: the toggle would look wired and the grid would never move. The
 * layer's RULES still apply and are followed one at a time below; only its
 * plumbing is unavailable.
 *
 *   - Rule 2 — cancel BEFORE patching, and only an entry that HAS data. A
 *     first-load query cancelled here would strand the grid empty.
 *   - Rule 5 — MERGE, never replace: the patch rewrites `starredBaseIds` and
 *     leaves `bases` / `baseStats` / `ownerNames` / `kbStorageLimit` alone.
 *   - Rule 1 — NO invalidation. The write's own end state is the whole answer;
 *     re-downloading the list would only re-fetch what we just computed. There
 *     is no cold-cache case to cover either (`coldKeys`): the only way to
 *     reach this control is a rendered card, which means the entry is warm.
 *   - Rule 4 — keyed by the id captured AT SUBMIT, in the mutation variables.
 *
 * ROLLBACK IS THE SNAPSHOT, NOT THE INVERSE OPERATION. On failure the previous
 * entry is restored wholesale rather than the id being toggled back — an
 * inverse would be wrong if a refetch landed in between, and it is the one
 * case where being exactly right costs nothing.
 */
export function useToggleBaseStar(workspaceId?: string) {
  const queryClient = useQueryClient();
  const key = knowledgeBasesQueryKey(workspaceId);
  return useMutation({
    mutationFn: ({ baseId, starred }: { baseId: string; starred: boolean }) =>
      setBaseStar(baseId, starred, workspaceId),
    onMutate: async ({ baseId, starred }) => {
      const previous = queryClient.getQueryData<KnowledgeBaseList>(key);
      // Declines on a cold entry — there is nothing to patch and nothing to
      // roll back to, and cancelling a first load would leave the surface
      // empty with no request scheduled to fill it.
      if (!previous) return { previous: undefined };
      await queryClient.cancelQueries({ queryKey: key });
      queryClient.setQueryData<KnowledgeBaseList>(key, (prev) =>
        prev
          ? {
              ...prev,
              starredBaseIds: starred
                ? prev.starredBaseIds.includes(baseId)
                  ? prev.starredBaseIds
                  : [...prev.starredBaseIds, baseId]
                : prev.starredBaseIds.filter((id) => id !== baseId),
            }
          : prev
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
  });
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

/**
 * Drop every cached read of a base that no longer exists.
 *
 * Deletes are permanent (ENGINEERING §7, 2026-08-07) and `useKnowledgeQuery`
 * prefers `data` over `error` on purpose — so an invalidated entry still
 * RENDERS the deleted base's content rather than surfacing its 404, and the
 * cache is IndexedDB-persisted with a 24h `gcTime`, so it survives relaunch.
 * Invalidating the base LIST is therefore not enough: the tree and every entry
 * body under it have to leave the cache outright.
 *
 * Entry ids come from the cached tree because that is the only place the
 * base→entry mapping exists client-side; a base whose tree was never opened
 * has no entry bodies cached either, so nothing is missed.
 */
export function evictDeletedBase(
  queryClient: QueryClient,
  workspaceId: string | undefined,
  baseId: string
): void {
  const ws = workspaceId ?? "default";
  const treeKey = ["knowledge", `tree:${ws}:${baseId}`];
  const tree = queryClient.getQueryData<{ entries: KnowledgeEntry[] }>(treeKey);
  for (const entry of tree?.entries ?? []) {
    queryClient.removeQueries({ queryKey: ["knowledge", `entry:${ws}:${entry.id}`], exact: true });
  }
  queryClient.removeQueries({ queryKey: treeKey, exact: true });
}
