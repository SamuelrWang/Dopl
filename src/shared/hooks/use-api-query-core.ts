"use client";

import { useCallback, useEffect } from "react";
import {
  keepPreviousData,
  useQuery,
  type DefaultError,
  type UseQueryOptions,
} from "@tanstack/react-query";
import type { ApiRequestOpts } from "@/shared/api/api-envelope";

/**
 * The GET-hook contract, parameterized by transport — ⚠ the ONE implementation
 * behind `@/shared/hooks/use-api-query` (web) and `#/hooks/use-api-query`
 * (desktop SPA). Different transports, identical contract; never fork it, the
 * cache-key contract `[path, workspaceId, query]` is what request-dedup rests on.
 */

export type ApiRequestFn = <T>(
  path: string,
  opts?: Pick<ApiRequestOpts, "workspaceId" | "query" | "signal">
) => Promise<T>;

export interface UseApiQueryOpts<T, S = T>
  extends Pick<ApiRequestOpts, "workspaceId" | "query"> {
  /** Map the raw response body to the hook's data shape. */
  select?: (body: T) => S;
  /** Pause the query (e.g. while the workspace id is unresolved). */
  enabled?: boolean;
  /** Override provider default (ms). ⚠ OMIT to inherit
   *  `QUERY_DEFAULT_OPTIONS.staleTime` (30s); `0` means "always revalidate",
   *  NOT "unset" (see `definedOnly` / F-163). */
  staleTime?: number;
  /** Refetch interval in ms for polling endpoints. */
  refetchInterval?: number;
  /** Keep prior key's data visible while a new key loads (TanStack
   *  `placeholderData: keepPreviousData`) — no blank flash on key change. */
  keepPreviousData?: boolean;
}

/** ⚠ Must match what `@/shared/api/query-keys` builds for the write side
 *  (`path` nullable only here — a disabled query still needs a key). */
type ApiQueryKeyTuple = readonly [
  path: string | null,
  workspaceId: string | undefined,
  query: ApiRequestOpts["query"],
];

/**
 * Drop every key whose value is `undefined`.
 *
 * ⚠ F-163: TanStack resolves options by SPREAD — `{...defaultOptions.queries,
 * ...options}` — so a key PRESENT with value `undefined` OVERRIDES the client
 * default instead of falling back to it. Forwarding `staleTime: opts.staleTime`
 * unconditionally silently deleted `QUERY_DEFAULT_OPTIONS.staleTime` (30s) for
 * every caller that named none, making every such query stale on arrival.
 * Structural, not one `if` — the trap applies to every forwarded option.
 *
 * ⚠ `0` IS NOT "UNSET": an explicit `staleTime: 0` must beat the 30s default,
 * hence `!== undefined` and never a truthiness test.
 */
function definedOnly<T extends object>(options: T): Partial<T> {
  const defined: Partial<T> = {};
  for (const key of Object.keys(options) as (keyof T)[]) {
    if (options[key] !== undefined) defined[key] = options[key];
  }
  return defined;
}

/** `path === null` disables the query; a caller's `enabled` narrows further.
 *  ⚠ Shared by the options builder AND the hook so they can never disagree. */
function resolveEnabled(path: string | null, opts: { enabled?: boolean }): boolean {
  return path !== null && (opts.enabled ?? true);
}

/** Exact options `useApiQueryWith` hands TanStack. Exported so tests assert what
 *  a query ACTUALLY resolves with (`queryClient.defaultQueryOptions(...)`), not
 *  what the hook appears to pass — the distinction F-163 lived in. */
export function buildApiQueryOptions<T, S = T>(
  request: ApiRequestFn,
  path: string | null,
  opts: UseApiQueryOpts<T, S> = {}
): UseQueryOptions<T, DefaultError, S, ApiQueryKeyTuple> {
  return {
    queryKey: [path, opts.workspaceId, opts.query] as const,
    queryFn: ({ signal }) =>
      request<T>(path as string, {
        workspaceId: opts.workspaceId,
        query: opts.query,
        signal,
      }),
    enabled: resolveEnabled(path, opts),
    // ⚠ EVERY caller-supplied option goes through `definedOnly` — an unnamed
    // option must be ABSENT, not present-and-undefined, or it deletes the
    // client default.
    ...definedOnly({
      select: opts.select,
      staleTime: opts.staleTime,
      refetchInterval: opts.refetchInterval,
      placeholderData: opts.keepPreviousData ? keepPreviousData : undefined,
    }),
  };
}

/**
 * The query key is `[path, workspaceId, query]` — pass the same args from any
 * component and they share one cache entry + one in-flight request. Invalidate
 * after mutations via `queryClient.invalidateQueries({ queryKey: [path] })`.
 */
export function useApiQueryWith<T, S = T>(
  request: ApiRequestFn,
  path: string | null,
  opts: UseApiQueryOpts<T, S> = {}
) {
  const enabled = resolveEnabled(path, opts);
  const query = useQuery(buildApiQueryOptions<T, S>(request, path, opts));

  // ⚠ SELF-HEAL a stranded query: when an observer's key switches inside the
  // same commit as a redirect navigation, TanStack v5 can leave the NEW query
  // enabled+pending+idle — created and never dispatched, i.e. a navigation stuck
  // on a loading screen forever. That state has one legal next step (fetch), so
  // the nudge is safe; the 50ms delay lets normal dispatch win ordinary mounts.
  const stranded = enabled && query.isPending && query.fetchStatus === "idle";
  const strandedRefetch = query.refetch;
  useEffect(() => {
    if (!stranded) return;
    const timer = setTimeout(() => void strandedRefetch(), 50);
    return () => clearTimeout(timer);
  }, [stranded, strandedRefetch]);

  // ⚠ TanStack v5 refetch() IGNORES `enabled` — on a null-path query it would
  // fire a real request at a garbage URL. Contract: refetch on a disabled query
  // is a no-op.
  const rawRefetch = query.refetch;
  const refetch = useCallback<typeof rawRefetch>(
    (...args) => (enabled ? rawRefetch(...args) : Promise.resolve(undefined as never)),
    [enabled, rawRefetch]
  );

  return { ...query, refetch };
}
