/**
 * THE PERSISTER'S WRITE IS A BOUND, NOT AN OPTIMISATION (2026-08-30, the desktop
 * abort-churn incident).
 *
 * WHAT THIS EXISTS FOR. `persistQueryClientSubscribe` (the library, inside
 * `PersistQueryClientProvider`) subscribes to BOTH the QueryCache and the MutationCache
 * and calls `persistClient` on every `added` / `removed` / `updated` event. It does not
 * await the result, does not throttle it, and offers no option to. Each call is a full
 * synchronous `dehydrate()` of the entire cache.
 *
 * So in the incident state — every request 401ing or aborting, every mounted query
 * cycling fetching → error → retry → error, and `app.tsx › App` calling
 * `queryClient.clear()` (which emits one `removed` event PER QUERY) on every auth flap —
 * this produced hundreds of complete cache snapshots, all in flight at once, each
 * retaining its own deep copy until its IndexedDB transaction was scheduled, and each
 * opening a NEW `indexedDB.open()` connection. That is a renderer-heap accumulation with
 * no ceiling, driven by a loop with no ceiling.
 *
 * Three properties, and all three are load-bearing:
 *   1. at most ONE write in flight, so snapshots cannot pile up;
 *   2. LATEST WINS — superseded snapshots are dropped, never queued;
 *   3. ONE connection, reused, and every `open` settles (an `onblocked` open with no
 *      handler never settled, orphaning its promise, its snapshot and its connection).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PersistedClient } from "@tanstack/react-query-persist-client";

// ⚠ RE-IMPORTED PER TEST. The reused connection is module state (`dbHandle`), which is
// exactly the thing under test — a handle cached from one test's fake would be handed to
// the next one's, and the open-count assertions would read zero for the wrong reason.
async function loadPersister() {
  vi.resetModules();
  return (await import("./idb-persister")).createIdbPersister();
}

// ── A minimal fake IndexedDB ────────────────────────────────────────────────
// Enough surface for this module: open → transaction → objectStore → put/get/delete.
// ⚠ Every request settles on a real MACROTASK, exactly as the browser's does, so the
// ordering under test is the ordering that ships — a hand-pumped microtask queue would
// let a coalescing bug pass by construction.

interface FakeOpts {
  /** Fire `onblocked` instead of `onsuccess` for the FIRST open. */
  blockFirstOpen?: boolean;
  /** Make every `put` fail. */
  failWrites?: boolean;
}

const settle = (fn: () => void) => setTimeout(fn, 0);

function installFakeIdb(opts: FakeOpts = {}) {
  const stats = { opens: 0, puts: 0 };
  const written: unknown[] = [];

  const makeStore = () => ({
    put(value: unknown) {
      stats.puts += 1;
      const req: Record<string, unknown> = { result: undefined, error: null };
      settle(() => {
        if (opts.failWrites) {
          req.error = new Error("quota");
          (req.onerror as (() => void) | undefined)?.();
        } else {
          written.push(value);
          (req.onsuccess as (() => void) | undefined)?.();
        }
      });
      return req;
    },
    get() {
      const req: Record<string, unknown> = { result: written[written.length - 1] };
      settle(() => (req.onsuccess as (() => void) | undefined)?.());
      return req;
    },
    delete() {
      const req: Record<string, unknown> = { result: undefined };
      settle(() => {
        written.length = 0;
        (req.onsuccess as (() => void) | undefined)?.();
      });
      return req;
    },
  });

  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => makeStore(),
    transaction: () => ({ objectStore: () => makeStore() }),
    close() {},
    onclose: null as null | (() => void),
    onversionchange: null as null | (() => void),
  };

  const indexedDB = {
    open() {
      stats.opens += 1;
      const req: Record<string, unknown> = { result: db, error: null };
      const blocked = opts.blockFirstOpen && stats.opens === 1;
      settle(() => {
        if (blocked) (req.onblocked as (() => void) | undefined)?.();
        else (req.onsuccess as (() => void) | undefined)?.();
      });
      return req;
    },
  };

  vi.stubGlobal("indexedDB", indexedDB);
  return { stats, written, db };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const snapshot = (tag: string) =>
  ({ buster: tag, timestamp: 0, clientState: { mutations: [], queries: [] } }) as
    unknown as PersistedClient;

describe("createIdbPersister", () => {
  it("coalesces a burst into ONE write and keeps the LAST snapshot", async () => {
    // The shape of `queryClient.clear()`: one event per removed query, none awaited.
    const idb = installFakeIdb();
    const p = await loadPersister();

    const writes = [
      p.persistClient(snapshot("a")),
      p.persistClient(snapshot("b")),
      p.persistClient(snapshot("c")),
      p.persistClient(snapshot("d")),
      p.persistClient(snapshot("e")),
    ];
    await Promise.all(writes);

    // ⚠ THE BOUND IS TWO, not one, and two is the honest number: one write is already in
    // flight when the burst arrives and cannot be recalled, so the most that can be
    // retained is that one plus the newest queued. Everything between them — b, c, d —
    // is DROPPED, which is the accumulation this replaces. Before the fix this was five
    // full dehydrated snapshots and five `indexedDB.open()` connections.
    expect(idb.stats.puts).toBeLessThanOrEqual(2);
    expect(idb.written.map((w) => (w as PersistedClient).buster)).not.toContain("c");
    // …and what reaches disk LAST is the newest state, never a superseded one.
    expect((idb.written[idb.written.length - 1] as PersistedClient).buster).toBe("e");
  });

  it("a snapshot arriving DURING a write is not dropped — it is the next write", async () => {
    // The queued slot is taken before the await, so a save landing mid-transaction
    // cannot be mistaken for one already written.
    const idb = installFakeIdb();
    const p = await loadPersister();

    const first = p.persistClient(snapshot("one"));
    await Promise.resolve(); // the write is now in flight
    const second = p.persistClient(snapshot("two"));
    await Promise.all([first, second]);

    expect((idb.written[idb.written.length - 1] as PersistedClient).buster).toBe("two");
    expect(idb.stats.puts).toBeLessThanOrEqual(2);
  });

  it("holds ONE connection across many writes instead of opening one per event", async () => {
    const idb = installFakeIdb();
    const p = await loadPersister();

    // `Persister.persistClient` is typed `Promisable<void>`, so each call is awaited on
    // its own line rather than chained.
    await p.persistClient(snapshot("1"));
    await p.persistClient(snapshot("2"));
    await p.persistClient(snapshot("3"));

    expect(idb.stats.opens).toBe(1);
  });

  it("a failed write does not wedge the writer — the next snapshot still lands", async () => {
    // Quota/corruption is best-effort by contract; what must never happen is a
    // permanently-held `draining` latch, which would silently stop all persistence.
    const idb = installFakeIdb({ failWrites: true });
    const p = await loadPersister();
    await p.persistClient(snapshot("x"));
    // The latch released, so a second call schedules a second attempt.
    await p.persistClient(snapshot("y"));
    expect(idb.stats.puts).toBe(2);
  });

  it("a BLOCKED open settles instead of orphaning the promise and its snapshot", async () => {
    // With no `onblocked` handler this promise never settled — and it retained a full
    // dehydrated cache and a connection, once per cache event.
    const idb = installFakeIdb({ blockFirstOpen: true });
    const p = await loadPersister();

    let settled = false;
    await Promise.resolve(p.persistClient(snapshot("blocked"))).then(() => {
      settled = true;
    });

    expect(settled).toBe(true);
    expect(idb.written).toHaveLength(0);
  });

  it("restore and remove still work, and degrade to 'no cache' rather than throwing", async () => {
    const idb = installFakeIdb();
    const p = await loadPersister();
    await p.persistClient(snapshot("kept"));
    expect(idb.written).toHaveLength(1);

    const restored = p.restoreClient();
    expect(((await restored) as PersistedClient).buster).toBe("kept");

    const removed = p.removeClient();
    await expect(removed).resolves.toBeUndefined();
    expect(idb.written).toHaveLength(0);

    vi.stubGlobal("indexedDB", undefined);
    await expect((await loadPersister()).restoreClient()).resolves.toBeUndefined();
  });
});
