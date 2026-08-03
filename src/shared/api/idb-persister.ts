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
