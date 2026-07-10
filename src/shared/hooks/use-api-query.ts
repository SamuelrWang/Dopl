"use client";

import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, type ApiRequestOpts } from "@/shared/api/api-client";

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
}

/**
 * useApiQuery — the standard client GET hook (successor to `useApiGet`
 * and the per-feature `useFetch` copies). TanStack Query supplies
 * caching, dedupe, focus revalidation, and keep-previous-data; this
 * wrapper binds it to `apiRequest` and the app's URL/workspace-header
 * conventions.
 *
 * The query key is `[path, workspaceId, query]` — pass the same args
 * from any component and they share one cache entry + one in-flight
 * request. Invalidate after mutations via
 * `queryClient.invalidateQueries({ queryKey: [path] })`.
 */
export function useApiQuery<T, S = T>(
  path: string | null,
  opts: UseApiQueryOpts<T, S> = {}
) {
  const enabled = path !== null && (opts.enabled ?? true);
  const query = useQuery({
    queryKey: [path, opts.workspaceId, opts.query] as const,
    queryFn: ({ signal }) =>
      apiRequest<T>(path as string, {
        workspaceId: opts.workspaceId,
        query: opts.query,
        signal,
      }),
    enabled,
    select: opts.select,
    staleTime: opts.staleTime,
    refetchInterval: opts.refetchInterval,
  });

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
