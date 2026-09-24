"use client";

/**
 * Knowledge API client hooks, on TanStack Query.
 *
 * `Result<T>` shape is a contract — frozen canvas panels consume
 * `{ data, status, error, refetch }`; keep stable. `data` is held during a
 * same-key refetch (no flicker), cleared on key change (no cross-workspace leak).
 */
import {
  GENERIC_ERROR_MESSAGE,
  NETWORK_ERROR_MESSAGE,
  isNetworkError,
} from "@/shared/api/api-envelope";
import { useCallback } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type {
  KbShelf,
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

/** SSR seed skipping the initial client fetch. Applied only when the seed key
 *  matches the hook's current key. */
interface UseFetchOptions<T> {
  initialData?: T;
  initialKey?: string;
}

function toApiError(err: unknown): KnowledgeApiError {
  if (err instanceof KnowledgeApiError) return err;
  if (isNetworkError(err)) {
    return new KnowledgeApiError(0, "NETWORK_UNAVAILABLE", NETWORK_ERROR_MESSAGE);
  }
  return new KnowledgeApiError(500, "INTERNAL_ERROR", GENERIC_ERROR_MESSAGE);
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

  // data wins over error: a failed background refetch (focus/reconnect) must
  // not blank rendered content. "error" only when nothing to show.
  const status: FetchStatus =
    key === null
      ? "idle"
      : query.data !== undefined
        ? "success"
        : query.error
          ? "error"
          : "loading";

  // v5 refetch() ignores `enabled` — a null-key hook would request a garbage
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

/** Base list and owner-name map in one cache entry: the route answers both in
 *  one response, so consumers share a request instead of hitting it twice. */
export function useKnowledgeBaseList(
  workspaceId?: string,
  options?: { initialData?: KnowledgeBaseList; shelf?: KbShelf }
): Result<KnowledgeBaseList> {
  // Workspace id in the key so switching workspaces re-fetches; the sentinel
  // fallback is a CACHE key, never a claim about which container answered.
  // Shelf in the key too: a narrowed read is a different response, and sharing
  // one entry would let an unfiltered refetch overwrite it.
  const key = knowledgeBasesCacheSegment(workspaceId, undefined, options?.shelf);
  return useKnowledgeQuery<KnowledgeBaseList>(
    key,
    () => fetchBaseList(workspaceId, undefined, options?.shelf),
    options?.initialData !== undefined
      ? { initialData: options.initialData, initialKey: key }
      : undefined
  );
}

/**
 * The base list's cache SEGMENT (the second element of its `["knowledge", …]`
 * key), for the workspace-wide list or for ONE channel's scope-A view of it.
 *
 * The channel-scoped segment is a different entry, not the same one with an
 * extra key: `?channelId=` changes the response (it folds in `channelGrants`),
 * so sharing a cache entry would let an unscoped refetch blank the grants the
 * scoped reader is rendering. A suffix beyond this one is prefix-matched by the
 * grant write's cache patch (`hooks-channel-grants.ts`).
 */
export function knowledgeBasesCacheSegment(
  workspaceId?: string,
  channelId?: string,
  shelf?: KbShelf
): string {
  const ws = `bases:${workspaceId ?? "default"}`;
  if (channelId) return `${ws}:channel:${channelId}`;
  // The shelf variant is a third entry, for the same reason: `?shelf=` changes
  // the rows, so an unfiltered refetch would otherwise fold the workspace shelf
  // back into the /home pane.
  // It extends the SEGMENT with a string, never a fourth array element, so
  // `invalidateKnowledgeBaseLists`'s `startsWith(target + ":")` predicate still
  // reaches it — a key off by one element is a silent no-op (§8).
  // `channelId` wins when both are given; no caller gives both.
  if (shelf) return `${ws}:shelf:${shelf}`;
  return ws;
}

/** Cache key shared by every reader and writer of the base list. */
export function knowledgeBasesQueryKey(
  workspaceId?: string,
  channelId?: string,
  shelf?: KbShelf
) {
  return [
    "knowledge",
    knowledgeBasesCacheSegment(workspaceId, channelId, shelf),
  ] as const;
}

/**
 * Invalidate EVERY base-list entry for one workspace — the unscoped list, each
 * `?channelId=` variant, and each `?shelf=` variant beside them.
 *
 * A prefix key will not do it: TanStack matches a query key ELEMENT BY ELEMENT,
 * and the channel/shelf variants are STRING extensions of the segment
 * (`"bases:W:channel:C"`), not extra array elements — so `["knowledge",
 * "bases:W"]` matches the unscoped entry and nothing else. Hence the predicate
 * on the segment, mirroring `patchChannelGrantInCache`'s
 * `segment === target || startsWith(target + ":")`.
 *
 * A blunter `invalidateQueries({ queryKey: ["knowledge"] })` would also drop
 * every tree and entry entry in the cache, re-fetching the open base's whole
 * tree on a rename.
 */
export function invalidateKnowledgeBaseLists(
  queryClient: QueryClient,
  workspaceId?: string
): void {
  void queryClient.invalidateQueries({
    predicate: (query) => isBaseListKey(query.queryKey, workspaceId),
  });
}

/**
 * Does this cache key address a base LIST for this workspace — the unscoped
 * entry or any `:channel:` / `:shelf:` variant beside it?
 *
 * One predicate, shared by the invalidator and the row seeder below — they are
 * the same question asked twice. `hooks-channel-grants.ts ›
 * patchChannelGrantInCache` mints the identical match by hand.
 */
function isBaseListKey(
  queryKey: readonly unknown[],
  workspaceId?: string
): boolean {
  const segment = queryKey[1];
  if (queryKey[0] !== "knowledge" || typeof segment !== "string") return false;
  const target = knowledgeBasesCacheSegment(workspaceId);
  return segment === target || segment.startsWith(`${target}:`);
}

/**
 * Upsert one base into the cached list(s), synchronously.
 *
 * Call BEFORE navigating to a just-created/renamed base: the controller
 * resolves the URL segment against this list, and navigate-then-refetch leaves
 * a window where the segment matches nothing and the move is silently dropped.
 *
 * Replace everywhere, insert in one place (2026-08-26):
 *
 *   - A base ALREADY IN a cached list is the same base wherever it is cached, so
 *     a rename must reach every variant, or it reverts the next time anything is
 *     selected — §8's silent no-op with a visible symptom.
 *   - A base NOT YET in a list may not belong there. Inserting it into every
 *     variant would put a home-shelf create into the workspace page's entry and
 *     a container create into the home list — F-331's shape exactly. So the
 *     INSERT goes to the ONE key the caller named and nowhere else.
 */
export function seedKnowledgeBase(
  queryClient: QueryClient,
  workspaceId: string | undefined,
  base: KnowledgeBase,
  /** Which shelf's entry may receive an INSERT — the one the creating surface is
   *  mounting, not a property of the row. Omit for the unfiltered list.
   *  Irrelevant to the replace half above, which reaches every variant. */
  shelf?: KbShelf
): void {
  queryClient.setQueriesData<KnowledgeBaseList>(
    { predicate: (query) => isBaseListKey(query.queryKey, workspaceId) },
    (prev) =>
      prev && prev.bases.some((b) => b.id === base.id)
        ? { ...prev, bases: prev.bases.map((b) => (b.id === base.id ? base : b)) }
        : prev
  );
  queryClient.setQueryData<KnowledgeBaseList>(
    knowledgeBasesQueryKey(workspaceId, undefined, shelf),
    (prev) =>
      prev && !prev.bases.some((b) => b.id === base.id)
        ? { ...prev, bases: [base, ...prev.bases] }
        : prev
  );
}

/**
 * Toggle the caller's star, optimistically. Star rides `starredBaseIds` on the
 * base-list cache entry, so the write patches one key and the grid reorders on
 * click, not on the round trip.
 *
 * Hand-rolled, not `useApiMutation` (INVARIANTS §8 rule 6): knowledge reads sit
 * under `["knowledge", key]` keys `apiQueryKey` never mints, so the write layer
 * would patch an unsubscribed key and fail silently. Its rules still apply
 * below: cancel before patching and only with data (2); merge, leaving `bases` /
 * `baseStats` / `ownerNames` / `kbStorageLimit` (5); no invalidation (1); key
 * from the id captured at submit (4). Rollback restores the SNAPSHOT, not the
 * inverse toggle — an inverse is wrong if a refetch landed between.
 */
export function useToggleBaseStar(workspaceId?: string, shelf?: KbShelf) {
  const queryClient = useQueryClient();
  // The shelf must match the list the surface mounted: this patches ONE entry,
  // so against a surface reading `bases:W:shelf:workspace` a plain `bases:W`
  // key patches nothing anybody is listening to — §8's silent no-op, the exact
  // failure `pages/home/knowledge-panel-cards.tsx › useStarToggle` exists to
  // avoid on the channel variant.
  const key = knowledgeBasesQueryKey(workspaceId, undefined, shelf);
  return useMutation({
    mutationFn: ({ baseId, starred }: { baseId: string; starred: boolean }) =>
      setBaseStar(baseId, starred, workspaceId),
    onMutate: async ({ baseId, starred }) => {
      const previous = queryClient.getQueryData<KnowledgeBaseList>(key);
      // decline on a cold entry: nothing to patch or roll back to, and
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
 * Invalidating the base LIST is not enough: `useKnowledgeQuery` prefers `data`
 * over `error`, so an invalidated entry still renders deleted content instead of
 * its 404, and IndexedDB persistence with 24h `gcTime` survives relaunch. Tree +
 * every entry body must be REMOVED. Entry ids come from the cached tree — the
 * only client-side base→entry mapping.
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
