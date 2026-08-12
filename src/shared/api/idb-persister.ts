"use client";

/**
 * Minimal IndexedDB persister for TanStack Query (Phase 1 of
 * docs/DESKTOP-MIGRATION-PLAN.md — local-first feel: a cold start renders
 * the last-known server state instantly while background refetches bring
 * it current).
 *
 * Why IndexedDB and not localStorage: the dehydrated cache can exceed the
 * ~5MB localStorage quota (chats + knowledge trees), localStorage is
 * synchronous on the main thread, and IndexedDB is what the Electron
 * renderer persists reliably per-partition.
 *
 * No external dependency — the three-operation surface TanStack's
 * `Persister` needs doesn't justify idb-keyval. Every operation is
 * guarded: persistence is a progressive enhancement, and a broken/absent
 * IndexedDB (SSR pass, private windows, corrupted profile) must degrade to
 * "no cache", never to a crash.
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
 * The persistence BUSTER — TanStack discards the whole restored snapshot when
 * this string differs from the one it was written with.
 *
 * Without it the snapshot survives deploys for its full `maxAge` (24h), so a
 * returning user hydrates day-old entries in the OLD response shape after any
 * non-additive API change and every consumer renders them until its background
 * refetch lands; `select()` functions and components indexing into new fields
 * see `undefined` (2026-08-03 fleet audit — the whole "works after a hard
 * reload" class of bugs). Keying it to the BUILD makes a deploy the
 * invalidation event, which is exactly the granularity of a response reshape.
 *
 * Vercel exposes the deployment id and commit sha to the browser for Next.js
 * projects; the explicit name is the escape hatch for other hosts. Local dev
 * has no build identity and keeps today's behaviour (no cross-build
 * invalidation) — a dev restarting the server is not a deploy.
 */
export const QUERY_CACHE_BUSTER = [
  CACHE_SCHEMA_VERSION,
  // `process` only exists where Next's compiler inlined these reads (the
  // literal `process.env.NEXT_PUBLIC_*` member expressions must stay inside
  // the branch for that inlining to fire). The Vite SPA has no Node globals —
  // an unguarded read is an import-time ReferenceError that whites out the
  // whole renderer — and it layers its own build identity on top
  // (`DESKTOP_QUERY_CACHE_BUSTER`, apps/desktop-ui/src/lib/query-client.ts).
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
