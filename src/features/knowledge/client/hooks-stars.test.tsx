// @vitest-environment jsdom
/**
 * `useToggleBaseStar`. Hand-rolled, not `use-api-mutation.ts`, because
 * knowledge reads aren't on `useApiQuery` (INVARIANTS §8 rule 6) — so this
 * file pins the rules that layer would have enforced: patch lands BEFORE the
 * request settles; MERGES (other folds survive); failure restores the
 * SNAPSHOT, not the inverse toggle; cold entry DECLINED; no invalidation.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  KnowledgeApiError: class extends Error {},
  fetchBaseList: vi.fn(),
  fetchEntry: vi.fn(),
  fetchTree: vi.fn(),
  setBaseStar: vi.fn(),
}));

import { setBaseStar } from "./api";
import type { KnowledgeBaseList } from "./api";
import { knowledgeBasesQueryKey, useToggleBaseStar } from "./hooks";

const mockSetStar = vi.mocked(setBaseStar);

const WS = "ws-1";
const KEY = knowledgeBasesQueryKey(WS);

/** Whole cache entry, not just stars — merge assertions read the siblings. */
function entry(starredBaseIds: string[]): KnowledgeBaseList {
  return {
    bases: [{ id: "kb-1" }, { id: "kb-2" }] as KnowledgeBaseList["bases"],
    ownerNames: { "u-other": "Dana Reed" },
    baseStats: {
      "kb-1": { entryCount: 12, lastEntryUpdatedAt: null, storageBytes: 900 },
    },
    kbStorageLimit: 5_000_000,
    starredBaseIds,
    sharedBaseIds: [],
    channelGrants: {},
  };
}

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function stars(): string[] | undefined {
  return client.getQueryData<KnowledgeBaseList>(KEY)?.starredBaseIds;
}

/** Hand-released request: the patch is only observably optimistic while its
 *  write is in flight. */
function heldWrite() {
  let settle!: (fail?: boolean) => void;
  mockSetStar.mockImplementation(
    () =>
      new Promise<void>((resolve, reject) => {
        settle = (fail) =>
          fail ? reject(new Error("star write failed")) : resolve();
      })
  );
  return () => settle;
}

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
});

afterEach(() => client.clear());

describe("useToggleBaseStar", () => {
  it("patches the cache BEFORE the request settles, and merges", async () => {
    client.setQueryData(KEY, entry([]));
    const release = heldWrite();
    const { result } = renderHook(() => useToggleBaseStar(WS), { wrapper });

    act(() => result.current.mutate({ baseId: "kb-1", starred: true }));

    await waitFor(() => expect(stars()).toEqual(["kb-1"]));
    // Optimistic window: the write has not answered yet.
    expect(mockSetStar).toHaveBeenCalledWith("kb-1", true, WS);

    // MERGE, never replace: the response is narrower than the entry, so
    // assigning over it drops four folds the toggle never saw.
    const cached = client.getQueryData<KnowledgeBaseList>(KEY);
    expect(cached?.bases).toHaveLength(2);
    expect(cached?.ownerNames).toEqual({ "u-other": "Dana Reed" });
    expect(cached?.kbStorageLimit).toBe(5_000_000);
    expect(cached?.baseStats["kb-1"].entryCount).toBe(12);

    act(() => release()());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(stars()).toEqual(["kb-1"]);
  });

  it("removes the id when unstarring", async () => {
    client.setQueryData(KEY, entry(["kb-1", "kb-2"]));
    mockSetStar.mockResolvedValue(undefined);
    const { result } = renderHook(() => useToggleBaseStar(WS), { wrapper });

    act(() => result.current.mutate({ baseId: "kb-1", starred: false }));

    await waitFor(() => expect(stars()).toEqual(["kb-2"]));
    expect(mockSetStar).toHaveBeenCalledWith("kb-1", false, WS);
  });

  it("ROLLS BACK to the snapshot when the write fails", async () => {
    client.setQueryData(KEY, entry(["kb-2"]));
    const release = heldWrite();
    const { result } = renderHook(() => useToggleBaseStar(WS), { wrapper });

    act(() => result.current.mutate({ baseId: "kb-1", starred: true }));
    await waitFor(() => expect(stars()).toEqual(["kb-2", "kb-1"]));

    act(() => release()(true));

    await waitFor(() => expect(stars()).toEqual(["kb-2"]));
    // SNAPSHOT, not the inverse op — everything else comes back with it.
    const cached = client.getQueryData<KnowledgeBaseList>(KEY);
    expect(cached?.bases).toHaveLength(2);
    expect(cached?.kbStorageLimit).toBe(5_000_000);
  });

  it("does not re-star an id it already holds", async () => {
    // Patch must be idempotent: a double click before the first write settles
    // must not leave a duplicate the sort trips over.
    client.setQueryData(KEY, entry(["kb-1"]));
    mockSetStar.mockResolvedValue(undefined);
    const { result } = renderHook(() => useToggleBaseStar(WS), { wrapper });

    act(() => result.current.mutate({ baseId: "kb-1", starred: true }));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(stars()).toEqual(["kb-1"]);
  });

  it("DECLINES a cold cache instead of inventing an entry", async () => {
    // No data ⇒ no patch, no snapshot, and critically NO cancel — cancelling
    // a first load strands the grid empty with nothing to fill it (§8 rule 2).
    mockSetStar.mockResolvedValue(undefined);
    const { result } = renderHook(() => useToggleBaseStar(WS), { wrapper });

    act(() => result.current.mutate({ baseId: "kb-1", starred: true }));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryData(KEY)).toBeUndefined();
    // Write still goes out: server is the point, patch is the optimisation.
    expect(mockSetStar).toHaveBeenCalledWith("kb-1", true, WS);
  });

  it("invalidates NOTHING — the write already computed the answer", async () => {
    client.setQueryData(KEY, entry([]));
    mockSetStar.mockResolvedValue(undefined);
    const { result } = renderHook(() => useToggleBaseStar(WS), { wrapper });

    act(() => result.current.mutate({ baseId: "kb-1", starred: true }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Re-downloading would re-fetch exactly what the patch produced.
    expect(client.getQueryState(KEY)?.isInvalidated).toBe(false);
  });
});
