import {
  useApiQueryWith,
  type UseApiQueryOpts,
} from "@/shared/hooks/use-api-query-core";
import { apiRequest } from "#/lib/api";

export type { UseApiQueryOpts };

/**
 * useApiQuery — THE way this renderer reads server data.
 *
 * The implementation is shared with the web app
 * (`@/shared/hooks/use-api-query-core`); this file only binds it to the SPA's
 * `apiRequest`, which is the one thing that genuinely differs (the two apps
 * have different transports under an identical contract). It used to be a
 * byte-for-byte fork, which meant the `[path, workspaceId, query]` cache-key
 * contract and the TanStack refetch workaround had two homes and no signal to
 * keep them in sync.
 *
 * The query key is `[path, workspaceId, query]` — pass the same args from any
 * component and they share one cache entry + one in-flight request. Invalidate
 * after mutations via `queryClient.invalidateQueries({ queryKey: [path] })`.
 * Writes do NOT use this hook: `useMutation` + `apiRequest` + invalidate.
 */
export function useApiQuery<T, S = T>(
  path: string | null,
  opts: UseApiQueryOpts<T, S> = {}
) {
  return useApiQueryWith<T, S>(apiRequest, path, opts);
}
