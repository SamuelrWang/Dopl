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
  options?: { initialData?: KnowledgeBaseList; shelf?: KbShelf }
): Result<KnowledgeBaseList> {
  // Workspace id in the key so switching workspaces re-fetches. Sentinel
  // fallback keeps the hook firing with no id (sole-workspace caller
  // auto-targets; multi-workspace fails closed as WORKSPACE_REQUIRED).
  // ⚠ SHELF IN THE KEY TOO, for the reason the channel variant is in it: a
  // narrowed read is a DIFFERENT RESPONSE, and sharing one entry would let an
  // unfiltered refetch overwrite what the narrowed reader is rendering.
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
 * ⚠ THE CHANNEL-SCOPED SEGMENT IS A DIFFERENT ENTRY, NOT THE SAME ONE WITH AN
 * EXTRA KEY. `?channelId=` changes the RESPONSE (it folds in `channelGrants`),
 * so the two must not share a cache entry or an unscoped refetch would blank
 * the grants the scoped reader is rendering. Minted here so every reader and
 * writer of either list agrees; a suffix beyond this one is prefix-matched by
 * the grant write's cache patch (`hooks-channel-grants.ts`).
 */
export function knowledgeBasesCacheSegment(
  workspaceId?: string,
  channelId?: string,
  shelf?: KbShelf
): string {
  const ws = `bases:${workspaceId ?? "default"}`;
  if (channelId) return `${ws}:channel:${channelId}`;
  // ⚠ THE SHELF VARIANT IS A THIRD ENTRY BESIDE THE OTHER TWO, for the same
  // reason and by the same mechanism: `?shelf=` changes the ROWS, so the
  // narrowed list and the unfiltered one cannot share a cache entry or an
  // unfiltered refetch would fold the workspace shelf back into the /home pane
  // — the whole bug this wave closes, re-entering through the cache.
  // ⚠ AND IT EXTENDS THE SEGMENT WITH A STRING, never a fourth array element,
  // so `invalidateKnowledgeBaseLists`'s `startsWith(target + ":")` predicate
  // reaches it unchanged. A key off by one ELEMENT is a silent no-op (§8); a
  // key off by one SUFFIX is still reachable. Read that helper's docblock
  // before inventing a fourth shape here.
  // ⚠ `channelId` WINS when both are given, and no caller gives both: a
  // container has no home shelf (`resolveHomeScope` fences the marker to the
  // caller's default STANDARD workspace), so `?channelId=&shelf=home` would be
  // a question with one possible answer — the empty list.
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
 * ⚠ THE SHELF VARIANTS COST THIS HELPER NOTHING, and that is the point of the
 * predicate being on the SEGMENT rather than on a fixed key list: they extend
 * the same `bases:<ws>` prefix with a string, so they were reachable the moment
 * they existed. A create on one shelf still invalidates the other — correct,
 * because "which shelf" is a server decision the client must re-ask for rather
 * than predict.
 *
 * 🔒 ⚠ A PREFIX WILL NOT DO IT, AND THAT IS THE WHOLE REASON THIS EXISTS.
 * TanStack matches a query key ELEMENT BY ELEMENT, and the channel variant is a
 * STRING extension of the segment (`"bases:W:channel:C"`), not an extra array
 * element — so `["knowledge", "bases:W"]` matches the unscoped entry and NOTHING
 * ELSE. Two call sites (`pages/home/knowledge-base-view.tsx` and
 * `pages/knowledge/index.tsx`) wrote that prefix with a comment claiming it
 * reached both, which was true only while the /home pane mounted an
 * ARRAY-extended key — the same mismatch that made the grant write a silent
 * no-op (`hooks-channel-grants.ts`). ONE shape, and one helper that knows it.
 *
 * ⚠ Matched by PREDICATE on the segment, deliberately mirroring
 * `patchChannelGrantInCache`'s `segment === target || startsWith(target + ":")`.
 * A blunter `invalidateQueries({ queryKey: ["knowledge"] })` would also drop
 * every TREE and ENTRY entry in the cache, re-fetching the open base's whole
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
 * ⚠ ONE PREDICATE, shared by the invalidator and the row seeder below, because
 * they are the same question asked twice and this repo has already paid for
 * them drifting (see the docblock above, and `hooks-channel-grants.ts ›
 * patchChannelGrantInCache`, which mints the identical match by hand).
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
 * ⚠ Call BEFORE navigating to a just-created/renamed base. The controller
 * resolves the URL segment against this list; navigate-then-refetch leaves a
 * window where the segment matches nothing and the move is silently dropped.
 *
 * 🔒 ⚠ REPLACE EVERYWHERE, INSERT IN ONE PLACE — and the asymmetry is the whole
 * design (2026-08-26). The two halves answer different questions:
 *
 *   - A base ALREADY IN a cached list is the SAME base wherever it is cached, so
 *     a rename must reach every variant. Seeding only the caller's key is what
 *     broke the workspace Knowledge page the moment it moved onto the
 *     `:shelf:workspace` entry: `base-settings-form.tsx` patched the plain key,
 *     nothing mounted it, and the renamed slug reverted the next time anything
 *     was selected — §8's silent no-op with a visible symptom.
 *   - A base NOT YET in a list may not belong there. Inserting it into every
 *     variant would put a home-shelf create into the workspace page's entry and
 *     a container create into the home list — F-331's shape exactly. So the
 *     INSERT goes to the ONE key the caller named and nowhere else.
 */
export function seedKnowledgeBase(
  queryClient: QueryClient,
  workspaceId: string | undefined,
  base: KnowledgeBase,
  /** WHICH shelf's entry may receive an INSERT — the one the creating surface
   *  is MOUNTING, not a property of the row. Omit for the unfiltered list.
   *  ⚠ Irrelevant to the replace half above, which reaches every variant. */
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
export function useToggleBaseStar(workspaceId?: string, shelf?: KbShelf) {
  const queryClient = useQueryClient();
  // ⚠ THE SHELF MUST MATCH THE LIST THE SURFACE MOUNTED. This patches ONE
  // entry; against a surface reading `bases:W:shelf:workspace` a plain
  // `bases:W` key patches nothing anybody is listening to and the star
  // round-trips with the card never changing — §8's silent no-op, and the exact
  // failure `pages/home/knowledge-panel-cards.tsx › useStarToggle` exists to
  // avoid on the channel variant.
  const key = knowledgeBasesQueryKey(workspaceId, undefined, shelf);
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
