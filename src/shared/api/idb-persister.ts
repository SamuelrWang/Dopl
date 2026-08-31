"use client";

/**
 * Minimal IndexedDB persister for TanStack Query — cold start renders
 * last-known server state while background refetches bring it current.
 *
 * IndexedDB over localStorage: the dehydrated cache can exceed the ~5MB
 * localStorage quota, localStorage is synchronous on the main thread, and
 * IndexedDB is what the Electron renderer persists reliably per-partition.
 *
 * ⚠ Every operation is guarded — persistence is a progressive enhancement, and a
 * broken/absent IndexedDB (SSR pass, private windows, corrupted profile) must
 * degrade to "no cache", never crash.
 */

import type {
  PersistedClient,
  Persister,
} from "@tanstack/react-query-persist-client";

const DB_NAME = "dopl-query-cache";
const STORE = "cache";
const KEY = "client";

/**
 * Bump when a change makes EXISTING persisted entries wrong in a way a deploy
 * id would not catch (e.g. reshaping the query-key contract itself).
 */
const CACHE_SCHEMA_VERSION = "1";

/**
 * Persistence BUSTER — TanStack discards the whole restored snapshot when this
 * string differs from the one it was written with.
 *
 * ⚠ Keyed to the BUILD, so a deploy is the invalidation event. Without it the
 * snapshot survives deploys for its full `maxAge` (24h): a returning user
 * hydrates day-old entries in the OLD response shape after any non-additive API
 * change, and `select()` functions / components indexing new fields see
 * `undefined` — the whole "works after a hard reload" class of bugs.
 *
 * Vercel exposes the deployment id and commit sha to the browser; the explicit
 * name is the escape hatch for other hosts. Local dev has no build identity and
 * does no cross-build invalidation — a dev restart is not a deploy.
 */
export const QUERY_CACHE_BUSTER = [
  CACHE_SCHEMA_VERSION,
  // ⚠ The literal `process.env.NEXT_PUBLIC_*` member expressions must stay
  // inside this branch for Next's compiler to inline them, and the guard is
  // required: the Vite SPA has no Node globals, so an unguarded read is an
  // import-time ReferenceError that whites out the whole renderer. The SPA
  // layers its own identity on top (`DESKTOP_QUERY_CACHE_BUSTER`,
  // apps/desktop-ui/src/lib/query-client.ts).
  (typeof process !== "undefined" &&
    (process.env.NEXT_PUBLIC_QUERY_CACHE_BUSTER ||
      process.env.NEXT_PUBLIC_VERCEL_DEPLOYMENT_ID ||
      process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA)) ||
    "dev",
].join(":");

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    // ⚠ EVERY OPEN MUST SETTLE (2026-08-30). `onblocked` fires when another
    // connection holds an older version open, and with no handler this promise
    // never settled — taking with it the caller's whole dehydrated snapshot and,
    // under the write storm below, one such orphan per cache event.
    req.onblocked = () =>
      reject(new Error("indexedDB open blocked by another connection"));
  });
}

/**
 * ONE CONNECTION, REUSED. `openDb()` per operation was a fresh `indexedDB.open()`
 * on every write, and the writes are per cache EVENT (see `persistClient`), so a
 * failing-query storm opened connections faster than they could be closed.
 * Invalidated whenever the handle stops being usable, so a caller never gets a
 * dead one.
 */
let dbHandle: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (dbHandle) return dbHandle;
  dbHandle = openDb().then(
    (handle) => {
      handle.onclose = () => {
        dbHandle = null;
      };
      // Another context is upgrading: let go rather than block it forever.
      handle.onversionchange = () => {
        handle.close();
        dbHandle = null;
      };
      return handle;
    },
    (err) => {
      dbHandle = null;
      throw err;
    }
  );
  return dbHandle;
}

async function withStore<T>(
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const handle = await db();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = handle.transaction(STORE, mode);
      const req = op(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    // A transaction that fails because the CONNECTION is gone must not leave the
    // dead handle cached for the next caller.
    dbHandle = null;
    throw err;
  }
}

/**
 * Create the persister; call only in the browser.
 *
 * ⚠ THE WRITE IS COALESCED, AND THAT IS A BOUND, NOT AN OPTIMISATION (2026-08-30,
 * the desktop abort-churn incident). `persistQueryClientSubscribe` calls
 * `persistClient` on EVERY QueryCache and MutationCache event — added, removed,
 * updated — and it does NOT await the result, throttle it, or offer an option to.
 * Each call is a full synchronous `dehydrate()` of the entire cache, so a storm of
 * failing queries (fetching → error → retry → error, times every mounted observer)
 * produced one complete snapshot per transition, all of them in flight at once,
 * each retaining its own deep copy of the cache until its IndexedDB transaction was
 * scheduled. `queryClient.clear()` is the worst case in one gesture: it emits one
 * `removed` event per query, so a single clear meant N unawaited snapshots.
 *
 * Latest-wins, one in flight: what reaches disk is always the newest state, the
 * retained snapshots are bounded at TWO (the one being written and the one queued),
 * and the intermediate snapshots — which nothing could ever read, since each is
 * superseded microseconds later — are dropped instead of written.
 */
export function createIdbPersister(): Persister {
  // The newest snapshot nobody has written yet. Overwritten, never queued: a
  // queue of superseded snapshots is the accumulation this replaces.
  let queued: PersistedClient | null = null;
  let draining: Promise<void> | null = null;

  const drain = async () => {
    try {
      while (queued) {
        const next = queued;
        queued = null; // ⚠ take it BEFORE the await, or a write landing during the
        // await would be dropped as "already written".
        try {
          await withStore("readwrite", (s) => s.put(next, KEY));
        } catch {
          // Quota/corruption/dead connection — skip this snapshot; the cache is
          // best-effort and the next event brings a fresher one.
        }
      }
    } finally {
      draining = null;
    }
  };

  return {
    persistClient: async (client: PersistedClient) => {
      queued = client;
      if (!draining) draining = drain();
      return draining;
    },
    restoreClient: async () => {
      try {
        return await withStore<PersistedClient | undefined>("readonly", (s) =>
          s.get(KEY)
        );
      } catch {
        return undefined;
      }
    },
    removeClient: async () => {
      try {
        await withStore("readwrite", (s) => s.delete(KEY));
      } catch {
        // Nothing to remove.
      }
    },
  };
}
