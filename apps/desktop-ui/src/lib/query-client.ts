import { QueryClient } from "@tanstack/react-query";
import type { PersistQueryClientProviderProps } from "@tanstack/react-query-persist-client";
import type { Persister } from "@tanstack/react-query-persist-client";
import { QUERY_CACHE_BUSTER, createIdbPersister } from "@/shared/api/idb-persister";
import {
  QUERY_CACHE_MAX_AGE_MS,
  QUERY_DEFAULT_OPTIONS,
} from "@/shared/api/query-defaults";

/**
 * The renderer's TanStack Query client. ⚠ Defaults are IMPORTED, not copied,
 * from the same `src/shared/api/query-defaults.ts` the web `QueryProvider`
 * mounts — staleTime/gcTime/retry can never drift between the two clients.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: QUERY_DEFAULT_OPTIONS });
}

/**
 * Disk half of the cache — the SAME IndexedDB persister the web app wraps its
 * client in (`src/shared/api/query-provider.tsx`). `gcTime: 24h` buys nothing
 * across a process exit, so this is what makes a relaunch feel instant.
 * Superseded when the planned main-process SQLite cache lands.
 *
 * Every op is guarded inside the persister: no usable IndexedDB degrades to
 * "no cache", never to a crash.
 */
export function createQueryPersister(): Persister {
  return createIdbPersister();
}

/**
 * Bump when a change to THIS renderer makes persisted entries wrong in a way
 * the build id would not catch — i.e. a change to the query-KEY contract
 * (`[path, workspaceId, query]`), which would hydrate an old snapshot under
 * keys that now mean something else.
 */
const RENDERER_CACHE_SCHEMA = "1";

/**
 * TanStack discards the ENTIRE restored snapshot when this differs from the
 * string it was written with. Two independent reasons a desktop snapshot goes
 * bad, hence both parts:
 *   1. `__DOPL_RENDERER_BUILD__` (Electron app version) — a shipped update can
 *      reshape how a response is read (`select()`, field indexing).
 *   2. `QUERY_CACHE_BUSTER` — the shared web tree's own buster, kept in so the
 *      two clients can never disagree about what a persisted entry means.
 */
const DESKTOP_QUERY_CACHE_BUSTER = [
  QUERY_CACHE_BUSTER,
  RENDERER_CACHE_SCHEMA,
  typeof __DOPL_RENDERER_BUILD__ === "string" ? __DOPL_RENDERER_BUILD__ : "dev",
].join(":");

/**
 * Three guards against a stale entry rendering as authoritative:
 *   - `maxAge` — nothing older than a day is restored. ⚠ `gcTime` must be >=
 *     this (see query-defaults).
 *   - `buster` — a bundle that reads responses differently starts from empty.
 *   - `dehydrateOptions` — only SETTLED SUCCESSES go to disk. A restored error
 *     renders as a phantom failure, a restored pending as a request that will
 *     never land.
 *
 * ⚠ Mutations are NEVER persisted. `PersistQueryClientProvider` would restore
 * paused ones and `resumePausedMutations` would REPLAY them next launch — a
 * write the user made no gesture for, against a workspace that has moved on.
 *
 * Restored data stays non-authoritative via the provider's `isRestoring` gate
 * plus `staleTime: 30s`: a restored `dataUpdatedAt` predates the process exit,
 * so a normal relaunch is stale on arrival and refetches in background.
 *
 * Relaunch inside 30s serves a still-FRESH entry without revalidating — the
 * same guarantee as navigating between two pages 20s apart. Nothing that must
 * not be replayed rides on it: boot, the ontology snapshot and the channel
 * transcript all name `staleTime: 0`.
 */
export function createPersistOptions(
  persister: Persister
): PersistQueryClientProviderProps["persistOptions"] {
  return {
    persister,
    maxAge: QUERY_CACHE_MAX_AGE_MS,
    buster: DESKTOP_QUERY_CACHE_BUSTER,
    dehydrateOptions: {
      shouldDehydrateQuery: (query) => query.state.status === "success",
      shouldDehydrateMutation: () => false,
    },
  };
}
