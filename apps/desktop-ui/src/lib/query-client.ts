import { QueryClient } from "@tanstack/react-query";
import type { PersistQueryClientProviderProps } from "@tanstack/react-query-persist-client";
import type { Persister } from "@tanstack/react-query-persist-client";
import { QUERY_CACHE_BUSTER, createIdbPersister } from "@/shared/api/idb-persister";
import {
  QUERY_CACHE_MAX_AGE_MS,
  QUERY_DEFAULT_OPTIONS,
} from "@/shared/api/query-defaults";

/**
 * The renderer's TanStack Query client. The defaults are IMPORTED, not copied:
 * `@web/query-defaults` is an exact-match alias onto
 * `src/shared/api/query-defaults.ts`, the same module the web `QueryProvider`
 * mounts, so staleTime/gcTime/retry can never drift between the two clients.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: QUERY_DEFAULT_OPTIONS });
}

/**
 * The disk half of the cache — the SAME IndexedDB persister the web app wraps
 * its client in (`src/shared/api/query-provider.tsx`), now mounted here too.
 *
 * It was deliberately absent, deferred to a main-process SQLite cache in
 * Phase 2/3 of docs/DESKTOP-MIGRATION-PLAN.md, on the reasoning that two disk
 * caches with different lifetimes is worse than one. That cache does not
 * exist, and the cost of waiting was paid every launch: `gcTime: 24h` buys
 * nothing across a process exit, so the local-first flagship refetched its
 * entire world on every cold start — starting COLDER than the web app it
 * replaces, which has had this since Phase 1. When the main-process cache
 * lands, this is the thing it replaces; until then it is the thing that makes
 * a relaunch feel instant.
 *
 * Every operation is guarded inside the persister itself: a runtime with no
 * usable IndexedDB degrades to "no cache", never to a crash.
 */
export function createQueryPersister(): Persister {
  return createIdbPersister();
}

/**
 * Bumped when a change to THIS renderer makes existing persisted entries
 * wrong in a way the build id would not catch — i.e. a change to the
 * query-KEY contract itself (`[path, workspaceId, query]`), which would make
 * an old snapshot hydrate under keys that now mean something else.
 */
const RENDERER_CACHE_SCHEMA = "1";

/**
 * The buster. TanStack discards the ENTIRE restored snapshot when this
 * differs from the string it was written with, and there are two independent
 * reasons a desktop snapshot goes bad:
 *
 *   1. The renderer bundle changed — a shipped app update can reshape how a
 *      response is read (`select()` functions, components indexing into
 *      fields), and the persisted entry is yesterday's shape.
 *      `__DOPL_RENDERER_BUILD__` is the Electron app version, which is the
 *      packaged equivalent of the web buster's deployment id.
 *   2. The shared web tree's own buster moved (`QUERY_CACHE_BUSTER`) — kept
 *      in the string so the two clients can never disagree about what a
 *      persisted entry means.
 */
const DESKTOP_QUERY_CACHE_BUSTER = [
  QUERY_CACHE_BUSTER,
  RENDERER_CACHE_SCHEMA,
  typeof __DOPL_RENDERER_BUILD__ === "string" ? __DOPL_RENDERER_BUILD__ : "dev",
].join(":");

/**
 * How the restored snapshot is allowed to be used. Three separate guards
 * against a stale entry rendering as if it were authoritative:
 *
 *   - `maxAge` — nothing older than a day is restored at all. Past that the
 *     page loads honestly, the same bound the web app uses (and the reason
 *     `gcTime` must be >= it, see query-defaults).
 *   - `buster` — see above; a bundle that reads responses differently starts
 *     from empty rather than from a shape it no longer understands.
 *   - `dehydrateOptions` — only SETTLED SUCCESSES go to disk. An error entry
 *     restored from disk renders as a phantom failure, and a pending one as a
 *     request that will never land.
 *
 * Mutations are never persisted. `PersistQueryClientProvider` would otherwise
 * restore paused ones and `resumePausedMutations` would REPLAY them on the
 * next launch — a write the user made no gesture for, applied to a workspace
 * whose state has moved on. The optimistic-mutation layer makes that a live
 * hazard rather than a theoretical one.
 *
 * What makes restored data non-authoritative rather than merely fresh-looking
 * is the provider's own `isRestoring` gate plus `staleTime: 30s`: a restored
 * query's `dataUpdatedAt` predates the process exit, so on any normal relaunch
 * it is stale on arrival and refetches in the background on first mount. It is
 * a first paint, not an answer.
 *
 * THE ONE GAP, and why it is not one: relaunching inside 30s restores an entry
 * that is still FRESH, so it is served without revalidating. That is deliberate
 * — it is the same guarantee as navigating between two pages 20s apart, which
 * is the policy `staleTime: 30s` exists to state. Nothing that must not be
 * replayed rides on it: the boot answer names `staleTime: 0` +
 * `refetchOnMount: "always"` (a restored segment can be a corpse), the ontology
 * snapshot does the same, and the channel transcript names `staleTime: 0`.
 * Until F-163 was fixed this whole paragraph was accidental rather than true —
 * every `useApiQuery` read resolved to `staleTime: 0`, so restored entries
 * refetched for the wrong reason.
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
