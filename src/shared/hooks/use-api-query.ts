"use client";

import { apiRequest } from "@/shared/api/api-client";
import {
  useApiQueryWith,
  type UseApiQueryOpts,
} from "./use-api-query-core";

export type { UseApiQueryOpts };

/**
 * The standard client GET hook. `./use-api-query-core.ts` binds TanStack to the
 * app's URL/workspace-header conventions; this file binds THAT to the web
 * transport. The desktop SPA's `#/hooks/use-api-query` is the same over its own.
 *
 * Query key is `[path, workspaceId, query]` — same args from any component share
 * one cache entry + one in-flight request. Invalidate via
 * `queryClient.invalidateQueries({ queryKey: [path] })`.
 */
export function useApiQuery<T, S = T>(
  path: string | null,
  opts: UseApiQueryOpts<T, S> = {}
) {
  return useApiQueryWith<T, S>(apiRequest, path, opts);
}
