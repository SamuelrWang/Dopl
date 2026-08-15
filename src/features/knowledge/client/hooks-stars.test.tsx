// @vitest-environment jsdom
/**
 * `useToggleBaseStar` — the optimistic write behind the home grid's star.
 *
 * It is hand-rolled rather than built on `use-api-mutation.ts`, because
 * knowledge READS are not on `useApiQuery` (INVARIANTS §8 rule 6) — so the
 * rules that layer would have enforced are enforced here instead, and this
 * file is where they are pinned:
 *
 *   - the patch lands BEFORE the request settles (that is the whole feature),
 *   - it MERGES: every other fold on the same cache entry survives it,
 *   - a failure restores the SNAPSHOT, not the inverse toggle,
 *   - a cold entry is DECLINED rather than invented,
 *   - and nothing is invalidated, because the write's own end state is the
 *     entire answer.
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

/** The whole cache entry, not just the stars — the merge assertions read the
 *  siblings back out of it. */
function entry(starredBaseIds: string[]): KnowledgeBaseList {
  return {
    bases: [{ id: "kb-1" }, { id: "kb-2" }] as KnowledgeBaseList["bases"],
    ownerNames: { "u-other": "Dana Reed" },
    baseStats: {
      "kb-1": { entryCount: 12, lastEntryUpdatedAt: null, storageBytes: 900 },
    },
    kbStorageLimit: 5_000_000,
    starredBaseIds,
  };
}

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function stars(): string[] | undefined {
  return client.getQueryData<KnowledgeBaseList>(KEY)?.starredBaseIds;
}

/** A request the test releases by hand — an optimistic patch is only
 *  observably optimistic while its write is still in flight. */
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
    // The write has not answered yet — this is the optimistic window.
    expect(mockSetStar).toHaveBeenCalledWith("kb-1", true, WS);

    // MERGE, never replace: the response is narrower than the entry, and
    // assigning over it would silently drop four folds the toggle never saw.
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
    // The SNAPSHOT, not the inverse operation: everything else on the entry
    // comes back with it.
    const cached = client.getQueryData<KnowledgeBaseList>(KEY);
    expect(cached?.bases).toHaveLength(2);
    expect(cached?.kbStorageLimit).toBe(5_000_000);
  });

  it("does not re-star an id it already holds", async () => {
    // The optimistic patch has to be idempotent too — a double click before
    // the first write settles must not leave a duplicate the sort trips over.
    client.setQueryData(KEY, entry(["kb-1"]));
    mockSetStar.mockResolvedValue(undefined);
    const { result } = renderHook(() => useToggleBaseStar(WS), { wrapper });

    act(() => result.current.mutate({ baseId: "kb-1", starred: true }));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(stars()).toEqual(["kb-1"]);
  });

  it("DECLINES a cold cache instead of inventing an entry", async () => {
    // No data means no patch and no snapshot — and, critically, no cancel: a
    // first-load query cancelled here would strand the grid empty with nothing
    // scheduled to fill it (§8 rule 2).
    mockSetStar.mockResolvedValue(undefined);
    const { result } = renderHook(() => useToggleBaseStar(WS), { wrapper });

    act(() => result.current.mutate({ baseId: "kb-1", starred: true }));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryData(KEY)).toBeUndefined();
    // The write still went out — the server is the point, the patch is the
    // optimisation.
    expect(mockSetStar).toHaveBeenCalledWith("kb-1", true, WS);
  });

  it("invalidates NOTHING — the write already computed the answer", async () => {
    client.setQueryData(KEY, entry([]));
    mockSetStar.mockResolvedValue(undefined);
    const { result } = renderHook(() => useToggleBaseStar(WS), { wrapper });

    act(() => result.current.mutate({ baseId: "kb-1", starred: true }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Re-downloading the list would re-fetch exactly what the patch produced,
    // and would do it on the response the user is already looking at.
    expect(client.getQueryState(KEY)?.isInvalidated).toBe(false);
  });
});
