"use client";

import { useCallback, useEffect } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ApiRequestOpts } from "@/shared/api/api-envelope";

/**
 * The GET-hook contract, parameterized by transport — the one implementation
 * behind `@/shared/hooks/use-api-query` (web) and `#/hooks/use-api-query`
 * (desktop SPA).
 *
 * The two apps have different `apiRequest` transports under an IDENTICAL
 * contract, which is why the hook was forked byte-for-byte at the start of the
 * desktop migration. A fork is the wrong shape for that: the cache-key contract
 * `[path, workspaceId, query]` is what the whole request-dedup story rests on,
 * and a fix to one copy gave the other no signal to mirror it (2026-08-03 fleet
 * audit, duplication-quality). Passing the request function in costs one
 * argument and removes the drift entirely.
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
  /** Override the provider default (ms). */
  staleTime?: number;
  /** Refetch interval in ms for polling endpoints. */
  refetchInterval?: number;
  /** Keep the prior key's data visible while a new key's query loads
   *  (TanStack `placeholderData: keepPreviousData`) — avoids a blank
   *  flash when the query key changes for the same logical view. */
  keepPreviousData?: boolean;
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
  const enabled = path !== null && (opts.enabled ?? true);
  const query = useQuery({
    queryKey: [path, opts.workspaceId, opts.query] as const,
    queryFn: ({ signal }) =>
      request<T>(path as string, {
        workspaceId: opts.workspaceId,
        query: opts.query,
        signal,
      }),
    enabled,
    select: opts.select,
    staleTime: opts.staleTime,
    refetchInterval: opts.refetchInterval,
    placeholderData: opts.keepPreviousData ? keepPreviousData : undefined,
  });

  // SELF-HEAL a stranded query (2026-08-03, root cause of the app-shell
  // stale-segment flake): when an observer's key switches inside the same
  // commit as a redirect navigation, TanStack v5 can leave the NEW query at
  // status "pending" with fetchStatus "idle" — created, enabled, and never
  // dispatched. In the app that is a navigation stuck on a loading screen
  // forever. An enabled+pending+idle query has exactly one legal next step
  // (fetch), so nudging it is always safe; the short delay lets the normal
  // dispatch win every ordinary mount.
  const stranded = enabled && query.isPending && query.fetchStatus === "idle";
  const strandedRefetch = query.refetch;
  useEffect(() => {
    if (!stranded) return;
    const timer = setTimeout(() => void strandedRefetch(), 50);
    return () => clearTimeout(timer);
  }, [stranded, strandedRefetch]);

  // TanStack v5 refetch() IGNORES `enabled` — on a null-path/disabled
  // query it would fire a real request at a garbage URL. Restore the
  // old hooks' contract: refetch on a disabled query is a no-op.
  const rawRefetch = query.refetch;
  const refetch = useCallback<typeof rawRefetch>(
    (...args) => (enabled ? rawRefetch(...args) : Promise.resolve(undefined as never)),
    [enabled, rawRefetch]
  );

  return { ...query, refetch };
}
