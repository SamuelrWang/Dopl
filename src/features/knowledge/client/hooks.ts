"use client";

/**
 * Knowledge API client hooks, on TanStack Query.
 *
 * ⚠ `Result<T>` shape is a contract — frozen canvas panels consume
 * `{ data, status, error, refetch }`; keep stable. `data` held during same-key
 * refetch (no flicker), cleared on key change (no cross-workspace leak).
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

/** SSR seed skipping initial client fetch. Applied ONLY when seed key matches
 *  hook's current key. */
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

  // ⚠ Data wins over error: failed BACKGROUND refetch (focus/reconnect) must
  // not blank rendered content. "error" only when nothing to show.
  const status: FetchStatus =
    key === null
      ? "idle"
      : query.data !== undefined
        ? "success"
        : query.error
          ? "error"
          : "loading";

  // ⚠ v5 refetch() ignores `enabled` — null-key hook would request a garbage
  // URL (/api/knowledge/entries/null). No-op while idle.
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

/** Base list AND owner-name map in ONE cache entry: the route answers both in
 *  one response, so consumers share a request instead of hitting it twice. */
export function useKnowledgeBaseList(
  workspaceId?: string,
  options?: { initialData?: KnowledgeBaseList }
): Result<KnowledgeBaseList> {
  // Workspace id in the key so switching workspaces re-fetches. Sentinel
  // fallback keeps the hook firing with no id (sole-workspace caller
  // auto-targets; multi-workspace fails closed as WORKSPACE_REQUIRED).
  const key = knowledgeBasesCacheSegment(workspaceId);
  return useKnowledgeQuery<KnowledgeBaseList>(
    key,
    () => fetchBaseList(workspaceId),
    options?.initialData !== undefined
      ? { initialData: options.initialData, initialKey: key }
      : undefined
  );
}

/**
 * The base list's cache SEGMENT (the second element of its `["knowledge", …]`
 * key), for the workspace-wide list or for ONE channel's scope-A view of it.
 *
 * ⚠ THE CHANNEL-SCOPED SEGMENT IS A DIFFERENT ENTRY, NOT THE SAME ONE WITH AN
 * EXTRA KEY. `?channelId=` changes the RESPONSE (it folds in `channelGrants`),
 * so the two must not share a cache entry or an unscoped refetch would blank
 * the grants the scoped reader is rendering. Minted here so every reader and
 * writer of either list agrees; a suffix beyond this one is prefix-matched by
 * the grant write's cache patch (`hooks-channel-grants.ts`).
 */
export function knowledgeBasesCacheSegment(
  workspaceId?: string,
  channelId?: string
): string {
  const ws = `bases:${workspaceId ?? "default"}`;
  return channelId ? `${ws}:channel:${channelId}` : ws;
}

/** Cache key shared by every reader and writer of the base list. */
export function knowledgeBasesQueryKey(workspaceId?: string, channelId?: string) {
  return ["knowledge", knowledgeBasesCacheSegment(workspaceId, channelId)] as const;
}

/**
 * Upsert one base into the cached list, synchronously.
 *
 * ⚠ Call BEFORE navigating to a just-created/renamed base. The controller
 * resolves the URL segment against this list; navigate-then-refetch leaves a
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

/**
 * Toggle caller's star, OPTIMISTICALLY. Star rides `starredBaseIds` on the
 * base-list cache entry, so the write patches one key and the grid reorders on
 * click, not on the round trip.
 *
 * ⚠ HAND-ROLLED, not `useApiMutation`. INVARIANTS §8 rule 6: reads must be on
 * `useApiQuery` first, and knowledge reads sit under `["knowledge", key]` keys
 * `apiQueryKey` never mints — the write layer would patch an unsubscribed key
 * and fail SILENTLY. Its rules still apply, followed below: cancel before
 * patching and only with data (2); MERGE, leaving `bases` / `baseStats` /
 * `ownerNames` / `kbStorageLimit` (5); NO invalidation, cache always warm here
 * (1); key from the id captured AT SUBMIT (4). Rollback restores the SNAPSHOT,
 * not the inverse toggle — an inverse is wrong if a refetch landed between.
 */
export function useToggleBaseStar(workspaceId?: string) {
  const queryClient = useQueryClient();
  const key = knowledgeBasesQueryKey(workspaceId);
  return useMutation({
    mutationFn: ({ baseId, starred }: { baseId: string; starred: boolean }) =>
      setBaseStar(baseId, starred, workspaceId),
    onMutate: async ({ baseId, starred }) => {
      const previous = queryClient.getQueryData<KnowledgeBaseList>(key);
      // Decline on cold entry: nothing to patch or roll back to, and
      // cancelling a first load strands the surface empty.
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
 * Drop every cached read of a deleted base.
 *
 * ⚠ Invalidating the base LIST is NOT enough: `useKnowledgeQuery` prefers
 * `data` over `error`, so an invalidated entry still RENDERS deleted content
 * instead of its 404, and IndexedDB persistence with 24h `gcTime` survives
 * relaunch. Tree + every entry body must be REMOVED. Entry ids come from the
 * cached tree — the only client-side base→entry mapping.
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
