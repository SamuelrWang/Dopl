import {
  useApiQueryWith,
  type UseApiQueryOpts,
} from "@/shared/hooks/use-api-query-core";
import { apiRequest } from "#/lib/api";

export type { UseApiQueryOpts };

/**
 * useApiQuery — THE way this renderer reads server data.
 *
 * ⚠ Implementation is SHARED with the web app
 * (`@/shared/hooks/use-api-query-core`); this file only binds it to the SPA's
 * `apiRequest`, the one thing that differs. Never fork the core — the
 * cache-key contract and the TanStack refetch workaround must have one home.
 *
 * Query key is `[path, workspaceId, query]` — same args from any component
 * share one cache entry + one in-flight request. Invalidate after mutations
 * via `queryClient.invalidateQueries({ queryKey: [path] })`. Writes do NOT use
 * this hook: `useMutation` + `apiRequest` + invalidate.
 */
export function useApiQuery<T, S = T>(
  path: string | null,
  opts: UseApiQueryOpts<T, S> = {}
) {
  return useApiQueryWith<T, S>(apiRequest, path, opts);
}
