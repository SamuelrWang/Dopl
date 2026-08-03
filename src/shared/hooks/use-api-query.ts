"use client";

import { apiRequest } from "@/shared/api/api-client";
import {
  useApiQueryWith,
  type UseApiQueryOpts,
} from "./use-api-query-core";

export type { UseApiQueryOpts };

/**
 * useApiQuery — the standard client GET hook (successor to `useApiGet`
 * and the per-feature `useFetch` copies). TanStack Query supplies
 * caching, dedupe, focus revalidation, and keep-previous-data; the
 * implementation in `./use-api-query-core.ts` binds it to the app's
 * URL/workspace-header conventions, and this file binds THAT to the web
 * app's transport (`@/shared/api/api-client`). The desktop SPA's
 * `#/hooks/use-api-query` is the same three lines over its own transport.
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
  return useApiQueryWith<T, S>(apiRequest, path, opts);
}
