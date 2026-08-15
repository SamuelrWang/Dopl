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
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = op(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** Create the persister; call only in the browser. */
export function createIdbPersister(): Persister {
  return {
    persistClient: async (client: PersistedClient) => {
      try {
        await withStore("readwrite", (s) => s.put(client, KEY));
      } catch {
        // Quota/corruption — skip this snapshot; cache is best-effort.
      }
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
