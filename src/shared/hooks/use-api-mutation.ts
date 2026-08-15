"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  useMutation,
  useQueryClient,
  type QueryClient,
  type QueryKey,
  type UseMutationOptions,
} from "@tanstack/react-query";
import { apiRequest } from "@/shared/api/api-client";
import type { ApiRequestOpts } from "@/shared/api/api-envelope";
import {
  createRefetchCoordinator,
  type RefetchCoordinator,
} from "@/shared/realtime/refetch-coordinator";

/**
 * THE write hook — `useApiQuery`'s other half. Owns, so no call site does:
 *
 *  - **Optimistic write.** `optimistic: (draft) => patches` runs in `onMutate`,
 *    BEFORE the request leaves. Patched entries are snapshotted and restored
 *    verbatim by `onError`.
 *  - **Reconcile from the answer.** `reconcile: (data, draft) => patches` folds
 *    the server response into the cache. ⚠ A write whose response contains the
 *    created row does NOT need a refetch.
 *  - **Invalidation on settle** (success or failure) for caches this write could
 *    NOT reconcile. ⚠ Explicit on purpose: invalidating a cache you just
 *    reconciled re-downloads it and undoes the point.
 *  - **`pending`**, so callers keep no `useState` busy flag.
 *  - **`settleWith(gate)`** — composes `createRefetchCoordinator`: a realtime
 *    event arriving mid-write must not refetch over an in-flight local change.
 *    The gate counts writes in flight and releases the deferred refetch when the
 *    last settles.
 *
 * TRANSPORT-INJECTED like `use-api-query-core.ts`: implementation takes an
 * `ApiMutationRequestFn`; `useApiMutation` is the web binding, and the desktop
 * SPA binds `useApiMutationWith` to its own `apiRequest`.
 */

export type ApiMutationRequestFn = <T>(
  path: string,
  opts?: Pick<
    ApiRequestOpts,
    "method" | "body" | "workspaceId" | "query" | "expectedUpdatedAt"
  >
) => Promise<T>;

/** The HTTP call one draft turns into. */
export interface ApiMutationRequest {
  path: string;
  /** Defaults to POST — a mutation that GETs is a query. */
  method?: "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  workspaceId?: string;
  query?: ApiQueryParams;
  expectedUpdatedAt?: string;
}

type ApiQueryParams = ApiRequestOpts["query"];

/**
 * One cache edit: WHICH entries, and what they become. `key` is matched by
 * TanStack's array-prefix rule, so `apiPathKey(path)` patches every workspace /
 * query-param variant of a resource in one entry.
 */
export interface CachePatch {
  key: QueryKey;
  update: (cache: unknown) => unknown;
}

/**
 * Build a typed patch with the key bound. Cache type is erased at the boundary
 * so patches over different resources stay one array; checked in `update`.
 *
 * ⚠ `useApiQuery` stores the RAW response body and applies `select` on read, so
 * a messages patch operates on `{ messages: [...] }`, never the selected array.
 */
export function patchCache<TCache>(
  key: QueryKey,
  update: (cache: TCache | undefined) => TCache | undefined
): CachePatch {
  return { key, update: (cache) => update(cache as TCache | undefined) };
}

/**
 * COLD-CACHE FALLBACK (ENGINEERING §7, rule 1's one exception). Returns only
 * keys whose cache entry STILL holds no data. `optimistic`/`reconcile` both
 * decline on a data-less entry, so on a cold start or the IndexedDB restore
 * window a write lands server-side and never reaches the screen; a write whose
 * reconcile is its only path to the screen names its keys through this filter.
 * ⚠ Runs in `onSettled`, AFTER `reconcile`, so "still no data" IS the decline.
 */
export function coldKeys(client: QueryClient, keys: QueryKey[]): QueryKey[] {
  return keys.filter(
    (key) =>
      !client
        .getQueriesData({ queryKey: key })
        .some(([, data]) => data !== undefined)
  );
}

type PatchList = CachePatch | CachePatch[] | null | undefined;

function toPatches(value: PatchList): CachePatch[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

/** A write in flight, from the realtime coordinator's point of view. */
export interface MutationGate {
  begin(): void;
  end(): void;
}

export interface UseApiMutationConfig<TDraft, TData> {
  /** The request this draft becomes. */
  request: (draft: TDraft) => ApiMutationRequest;
  /** Cache edits applied before the request leaves; auto-snapshotted. */
  optimistic?: (draft: TDraft) => PatchList;
  /** Cache edits folded in from the server's answer. */
  reconcile?: (data: TData, draft: TDraft) => PatchList;
  /** Keys refetched once the write settles — only the ones `reconcile` left. */
  invalidate?: (draft: TDraft) => QueryKey[];
  /** Defer realtime refetches for the life of this write. */
  settleWith?: MutationGate;
  onSuccess?: (data: TData, draft: TDraft) => void;
  onError?: (error: unknown, draft: TDraft) => void;
}

/** What `onMutate` hands `onError` so a failure can put the cache back. */
export interface MutationRollback {
  snapshots: Array<[QueryKey, unknown]>;
}

/** Mutation options a config becomes. Exported so tests drive it via TanStack's
 *  framework-free `MutationObserver` — rollback and settle order pinned against
 *  the real machinery, not a re-implementation. */
export function buildApiMutationOptions<TDraft, TData>(
  client: QueryClient,
  request: ApiMutationRequestFn,
  config: UseApiMutationConfig<TDraft, TData>
): UseMutationOptions<TData, unknown, TDraft, MutationRollback> {
  return {
    mutationFn: (draft: TDraft) => {
      const call = config.request(draft);
      return request<TData>(call.path, {
        method: call.method ?? "POST",
        body: call.body,
        workspaceId: call.workspaceId,
        query: call.query,
        expectedUpdatedAt: call.expectedUpdatedAt,
      });
    },
    async onMutate(draft: TDraft) {
      config.settleWith?.begin();
      const patches = toPatches(config.optimistic?.(draft));
      // ⚠ CANCEL BEFORE PATCHING: TanStack's cancel reverts a query to its
      // pre-fetch state, so cancelling second restores the data the optimistic
      // write just replaced.
      // ⚠ ONLY QUERIES THAT ALREADY HAVE DATA. Cancel exists to stop an
      // in-flight READ landing on this write; a query on its FIRST load has
      // nothing to land on, and cancelling it strands the surface empty until
      // some unrelated signal refetches (e.g. sending into a still-loading
      // channel transcript).
      await Promise.all(
        patches.map((patch) =>
          client.cancelQueries({
            queryKey: patch.key,
            predicate: (query) => query.state.data !== undefined,
          })
        )
      );
      const snapshots: Array<[QueryKey, unknown]> = [];
      for (const patch of patches) {
        for (const [key, data] of client.getQueriesData({
          queryKey: patch.key,
        })) {
          snapshots.push([key, data]);
        }
        client.setQueriesData({ queryKey: patch.key }, patch.update);
      }
      return { snapshots };
    },
    onSuccess(data: TData, draft: TDraft) {
      for (const patch of toPatches(config.reconcile?.(data, draft))) {
        client.setQueriesData({ queryKey: patch.key }, patch.update);
      }
      config.onSuccess?.(data, draft);
    },
    onError(error: unknown, draft: TDraft, rollback?: MutationRollback) {
      for (const [key, data] of rollback?.snapshots ?? []) {
        client.setQueryData(key, data);
      }
      config.onError?.(error, draft);
    },
    onSettled(_data, _error, draft: TDraft) {
      for (const key of config.invalidate?.(draft) ?? []) {
        void client.invalidateQueries({ queryKey: key });
      }
      config.settleWith?.end();
    },
  };
}

export interface ApiMutation<TDraft, TData> {
  /** Fire and forget — errors land in `config.onError`. */
  mutate: (draft: TDraft) => void;
  /** Await the settle; rejects with the `ApiError` the transport threw. */
  mutateAsync: (draft: TDraft) => Promise<TData>;
  /** True from the click until the write settles. */
  pending: boolean;
  error: unknown;
}

/** The transport-injected implementation. */
export function useApiMutationWith<TDraft, TData>(
  request: ApiMutationRequestFn,
  config: UseApiMutationConfig<TDraft, TData>
): ApiMutation<TDraft, TData> {
  const client = useQueryClient();
  // ⚠ Config is rebuilt every render (callbacks close over props), so options
  // must read the LATEST one, not the one captured at mutation creation.
  const configRef = useRef(config);
  configRef.current = config;
  const options = useMemo(
    () =>
      buildApiMutationOptions<TDraft, TData>(client, request, {
        request: (draft) => configRef.current.request(draft),
        optimistic: (draft) => configRef.current.optimistic?.(draft),
        reconcile: (data, draft) => configRef.current.reconcile?.(data, draft),
        invalidate: (draft) => configRef.current.invalidate?.(draft) ?? [],
        get settleWith() {
          return configRef.current.settleWith;
        },
        onSuccess: (data, draft) => configRef.current.onSuccess?.(data, draft),
        onError: (error, draft) => configRef.current.onError?.(error, draft),
      }),
    [client, request]
  );
  const mutation = useMutation(options);
  return {
    mutate: mutation.mutate,
    mutateAsync: mutation.mutateAsync,
    pending: mutation.isPending,
    error: mutation.error,
  };
}

/** The web binding. */
export function useApiMutation<TDraft, TData>(
  config: UseApiMutationConfig<TDraft, TData>
): ApiMutation<TDraft, TData> {
  return useApiMutationWith<TDraft, TData>(apiRequest, config);
}

export interface RefetchGate {
  /** A realtime change arrived: refetch now, or defer past the current write. */
  signal: () => void;
  /** Hand to `settleWith` so a write holds the deferred refetch open. */
  gate: MutationGate;
  /** True while any gated write is in flight (rendering/inspection). */
  isBusy: () => boolean;
}

/** `createRefetchCoordinator` plus the write counter it needs, as one hook. Owns
 *  the counter so `settleWith: gate` is the whole integration; a write that
 *  throws still releases it (`onSettled` runs on both paths). */
export function useRefetchGate(run: () => void): RefetchGate {
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });
  const busyRef = useRef(0);
  const coordinatorRef = useRef<RefetchCoordinator | null>(null);
  // ⚠ Built on FIRST USE, never during render: refs may not be touched in the
  // render pass.
  const coordinator = useCallback((): RefetchCoordinator => {
    coordinatorRef.current ??= createRefetchCoordinator(() => runRef.current());
    return coordinatorRef.current;
  }, []);
  const gate = useMemo<MutationGate>(
    () => ({
      begin() {
        busyRef.current += 1;
      },
      end() {
        busyRef.current = Math.max(0, busyRef.current - 1);
        coordinator().settle(busyRef.current > 0);
      },
    }),
    [coordinator]
  );
  const signal = useCallback(() => {
    coordinator().request(busyRef.current > 0);
  }, [coordinator]);
  const isBusy = useCallback(() => busyRef.current > 0, []);
  return { signal, gate, isBusy };
}
