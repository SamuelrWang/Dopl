import { QueryClient } from "@tanstack/react-query";
import { QUERY_DEFAULT_OPTIONS } from "@/shared/api/query-defaults";

/**
 * The renderer's TanStack Query client. The defaults are IMPORTED, not copied:
 * `@web/query-defaults` is an exact-match alias onto
 * `src/shared/api/query-defaults.ts`, the same module the web `QueryProvider`
 * mounts, so staleTime/gcTime/retry can never drift between the two clients.
 *
 * NOT wired here: the IndexedDB persister the web app wraps this client in
 * (`src/shared/api/query-provider.tsx`). Persistence belongs to the main
 * process's SQLite cache in the target architecture (Phase 2/3 of
 * docs/DESKTOP-MIGRATION-PLAN.md) — adding an IndexedDB copy first would give
 * the desktop two disk caches with different lifetimes.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: QUERY_DEFAULT_OPTIONS });
}
