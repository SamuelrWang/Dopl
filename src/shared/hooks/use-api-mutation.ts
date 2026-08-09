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
 * THE write hook — `useApiQuery`'s missing other half.
 *
 * Before this the repo had zero `useMutation`, zero `onMutate` and zero
 * rollback: ~86 write sites hand-rolled `setBusy(true); await api(); await
 * refetch()`, so the fastest thing a click could produce was a dimmed button
 * for the length of two network hops, and the created row the POST already
 * answered with was thrown away and re-downloaded.
 *
 * What this owns, so no call site owns it again:
 *
 *  - **The optimistic write.** `optimistic: (draft) => patches` runs in
 *    `onMutate`, i.e. BEFORE the request leaves. Every patched cache entry is
 *    snapshotted first and restored verbatim by `onError`, so a failure is a
 *    revert rather than a stale lie.
 *  - **Reconciling from the answer.** `reconcile: (data, draft) => patches`
 *    folds the server's own response into the cache. A write whose response
 *    contains the created row does NOT need a refetch, and asking for one is
 *    how a 30-message send re-downloads 200.
 *  - **Invalidation on settle**, success or failure, for the caches this write
 *    could NOT reconcile itself. Deliberately explicit: invalidating the cache
 *    you just reconciled re-downloads it and undoes the point.
 *  - **`pending`**, so a caller never keeps its own `useState` busy flag.
 *  - **`settleWith(gate)`** — composition with `createRefetchCoordinator`,
 *    which already solves the hard half: a realtime event arriving mid-write
 *    must not refetch over an in-flight local change. The gate counts writes
 *    in flight and releases the coordinator's deferred refetch when the last
 *    one settles.
 *
 * TRANSPORT-INJECTED exactly like `use-api-query-core.ts`: the whole
 * implementation takes an `ApiMutationRequestFn`, and `useApiMutation` is the
 * three-line web binding over `@/shared/api/api-client`. The desktop SPA binds
 * `useApiMutationWith` to its own `apiRequest` and shares every line above.
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
 * TanStack's array-prefix rule, so `apiPathKey(path)` patches every workspace
 * / query-param variant of a resource in one entry.
 */
export interface CachePatch {
  key: QueryKey;
  update: (cache: unknown) => unknown;
}

/**
 * Build a typed patch — `(draft) => (cache) => nextCache` with the key bound.
 * The cache type is erased at the boundary so a list of patches over different
 * resources stays one array; it is checked where it matters, in `update`.
 *
 * NOTE the shape a patch receives: `useApiQuery` stores the RAW response body
 * and applies `select` on read, so a messages patch operates on
 * `{ messages: [...] }`, never on the selected array.
 */
export function patchCache<TCache>(
  key: QueryKey,
  update: (cache: TCache | undefined) => TCache | undefined
): CachePatch {
  return { key, update: (cache) => update(cache as TCache | undefined) };
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

/**
 * The mutation options a config becomes — exported so the behaviour can be
 * driven by TanStack's own framework-free `MutationObserver` in tests, i.e.
 * the rollback and the settle order are pinned against the real machinery
 * rather than a re-implementation of it.
 */
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
      // CANCEL BEFORE PATCHING, never after: TanStack's cancel reverts a query
      // to its pre-fetch state, so cancelling second would restore the very
      // data the optimistic write just replaced.
      //
      // AND ONLY QUERIES THAT ALREADY HAVE DATA. A cancel exists to stop an
      // in-flight READ landing on top of this write — a query on its FIRST
      // load has nothing to land on, the optimistic patch declines to seed it
      // (there is no list to append to), and cancelling it strands the surface
      // empty until some unrelated signal refetches. Sending into a channel
      // whose transcript is still loading is exactly that case.
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
  // The config is rebuilt every render (its callbacks close over props); the
  // options object must therefore read the LATEST one rather than the one
  // captured when the mutation was created.
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

/** The web binding. Same three lines as `use-api-query.ts`. */
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

/**
 * `createRefetchCoordinator` plus the write counter it needs, as one hook.
 *
 * The coordinator is deliberately framework-agnostic and takes `busy` as an
 * argument, which every caller then tracked with its own `useRef(0)` and its
 * own `finally` block. This owns that counter so `settleWith: gate` is the
 * whole integration, and a write that throws still releases it (`onSettled`
 * runs on both paths).
 */
export function useRefetchGate(run: () => void): RefetchGate {
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });
  const busyRef = useRef(0);
  const coordinatorRef = useRef<RefetchCoordinator | null>(null);
  // Built on FIRST USE, never in the render pass: refs may not be touched
  // during render, and nothing needs a coordinator until an event arrives.
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
