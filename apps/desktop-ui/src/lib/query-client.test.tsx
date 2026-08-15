/**
 * The renderer's PERSISTED query cache. Persistence is only a win if a restored
 * entry can never be mistaken for an authoritative one, which is what these
 * pin: what goes onto disk, what comes back off it, and that what comes back is
 * a FIRST PAINT that immediately revalidates — not an answer.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import type {
  PersistedClient,
  Persister,
} from "@tanstack/react-query-persist-client";
import type { Query } from "@tanstack/react-query";
import { describe, it, expect, vi } from "vitest";
import { QUERY_CACHE_BUSTER } from "@/shared/api/idb-persister";
import { QUERY_CACHE_MAX_AGE_MS } from "@/shared/api/query-defaults";
import {
  createPersistOptions,
  createQueryClient,
  createQueryPersister,
} from "./query-client";

const persistOptions = () => createPersistOptions(createQueryPersister());

/** A query in a given state, shaped enough for the dehydrate predicates. */
const queryIn = (status: "success" | "error" | "pending") =>
  ({ state: { status } }) as Query;

describe("persist options — what reaches disk", () => {
  it("persists only settled successes", () => {
    const should = persistOptions().dehydrateOptions?.shouldDehydrateQuery;

    expect(should?.(queryIn("success"))).toBe(true);
    // A restored error renders as a phantom failure; a restored pending as a
    // request that will never land.
    expect(should?.(queryIn("error"))).toBe(false);
    expect(should?.(queryIn("pending"))).toBe(false);
  });

  it("never persists a mutation", () => {
    // ⚠ Paused mutations would be restored AND replayed next launch — a write
    // the user made no gesture for.
    const should = persistOptions().dehydrateOptions?.shouldDehydrateMutation;
    expect(should).toBeDefined();
    expect(should?.({} as never)).toBe(false);
  });
});

describe("persist options — what comes back off disk", () => {
  it("expires the snapshot on the same bound as the web app", () => {
    expect(persistOptions().maxAge).toBe(QUERY_CACHE_MAX_AGE_MS);
    // ⚠ gcTime must be >= maxAge or a restored entry is collected before use.
    const gcTime = createQueryClient().getDefaultOptions().queries?.gcTime;
    expect(gcTime).toBeGreaterThanOrEqual(QUERY_CACHE_MAX_AGE_MS);
  });

  it("busts on the shared web buster AND on the renderer build", () => {
    const buster = String(persistOptions().buster);

    // Keyed to the web tree's buster so the two clients cannot disagree…
    expect(buster.startsWith(QUERY_CACHE_BUSTER)).toBe(true);
    // …and to this bundle's identity, which a shipped app update moves.
    expect(buster.endsWith(__DOPL_RENDERER_BUILD__)).toBe(true);
    expect(buster.split(":").length).toBeGreaterThan(
      QUERY_CACHE_BUSTER.split(":").length
    );
  });
});

describe("the persister degrades rather than crashing", () => {
  it("answers 'no cache' when IndexedDB is unavailable", async () => {
    // jsdom has no IndexedDB — same shape as a private window or corrupted
    // profile. Persistence is a progressive enhancement.
    const persister = createQueryPersister();
    await expect(persister.restoreClient()).resolves.toBeUndefined();
    await expect(
      persister.persistClient({ timestamp: 0, buster: "x", clientState: {} } as PersistedClient)
    ).resolves.toBeUndefined();
    await expect(persister.removeClient()).resolves.toBeUndefined();
  });
});

/** In-memory persister holding one snapshot, standing in for IndexedDB. */
function fakePersister(client?: PersistedClient): Persister {
  let stored = client;
  return {
    persistClient: async (next) => {
      stored = next;
    },
    restoreClient: async () => stored,
    removeClient: async () => {
      stored = undefined;
    },
  };
}

/** `ageMs` models a real relaunch gap: past the 30s staleTime, inside
 *  `maxAge`. */
function snapshot(buster: string, value: string, ageMs = 5 * 60_000): PersistedClient {
  return {
    timestamp: Date.now() - ageMs,
    buster,
    clientState: {
      mutations: [],
      queries: [
        {
          queryKey: ["/api/thing"],
          queryHash: '["/api/thing"]',
          state: {
            data: value,
            dataUpdateCount: 1,
            dataUpdatedAt: Date.now() - ageMs,
            error: null,
            errorUpdateCount: 0,
            errorUpdatedAt: 0,
            fetchFailureCount: 0,
            fetchFailureReason: null,
            fetchMeta: null,
            isInvalidated: false,
            status: "success",
            fetchStatus: "idle",
          },
        },
      ],
    },
  } as unknown as PersistedClient;
}

function Thing({ fetcher }: { fetcher: () => Promise<string> }) {
  const { data } = useQuery({ queryKey: ["/api/thing"], queryFn: fetcher });
  return <p>{data ?? "no data"}</p>;
}

/** REAL client + REAL persist options; only the disk is faked. */
function mount(persister: Persister, fetcher: () => Promise<string>) {
  return render(
    <PersistQueryClientProvider
      client={createQueryClient()}
      persistOptions={createPersistOptions(persister)}
    >
      <Thing fetcher={fetcher} />
    </PersistQueryClientProvider>
  );
}

describe("a restored entry is a first paint, not an answer", () => {
  it("paints the snapshot and revalidates it in the background", async () => {
    const buster = String(persistOptions().buster);
    const fetcher = vi.fn(async () => "fresh");

    mount(fakePersister(snapshot(buster, "from disk")), fetcher);

    // Cold start shows last-known state, not an empty screen…
    expect(await screen.findByText("from disk")).toBeInTheDocument();
    // …and is stale on arrival by construction (older than the 30s
    // staleTime), so it refetches and the server's answer replaces it.
    await waitFor(() => expect(screen.getByText("fresh")).toBeInTheDocument());
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("ignores a snapshot written by a different build", async () => {
    const fetcher = vi.fn(async () => "fresh");

    mount(fakePersister(snapshot("some-older-build", "from disk")), fetcher);

    // Never painted: a bundle that may read responses differently starts
    // from empty, not from a shape it no longer understands.
    expect(screen.queryByText("from disk")).not.toBeInTheDocument();
    expect(await screen.findByText("fresh")).toBeInTheDocument();
  });

  it("ignores a snapshot older than maxAge", async () => {
    const buster = String(persistOptions().buster);
    const fetcher = vi.fn(async () => "fresh");

    mount(
      fakePersister(snapshot(buster, "from disk", QUERY_CACHE_MAX_AGE_MS + 1000)),
      fetcher
    );

    expect(screen.queryByText("from disk")).not.toBeInTheDocument();
    expect(await screen.findByText("fresh")).toBeInTheDocument();
  });
});
