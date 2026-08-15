/**
 * The mutation layer's three load-bearing behaviours, driven through TanStack's
 * framework-free `MutationObserver`. ⚠ Deliberate: the contract is the ORDER
 * onMutate → mutationFn → onSuccess/onError → onSettled, and a hand-rolled
 * runner would pin a re-implementation instead.
 *
 * Proven: (1) the optimistic row is in the cache BEFORE the network settles;
 * (2) a failure restores the exact prior bytes; (3) the settle gate opens
 * exactly once on BOTH paths, so a throwing write cannot strand a deferred
 * refetch forever.
 */

import { describe, expect, it, vi } from "vitest";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { apiPathKey, apiQueryKey } from "@/shared/api/query-keys";
import {
  buildApiMutationOptions,
  patchCache,
  type ApiMutationRequestFn,
  type MutationGate,
} from "./use-api-mutation";

interface Row {
  id: string;
  body: string;
}
interface Cache {
  rows: Row[];
}

const PATH = "/api/things";
const WORKSPACE = "ws-1";
const KEY = apiQueryKey(PATH, { workspaceId: WORKSPACE });

function clientWith(rows: Row[]): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(KEY, { rows } satisfies Cache);
  return client;
}

function read(client: QueryClient): Cache | undefined {
  return client.getQueryData<Cache>(KEY);
}

/** Transport resolved by hand, recording the cache AS THE REQUEST LEAVES — the
 *  proof that the optimistic row lands before the network is even spoken to. */
function deferredRequest(observe?: () => unknown) {
  let settle!: (value: unknown) => void;
  let fail!: (error: unknown) => void;
  const pending = new Promise<unknown>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  const seen: unknown[] = [];
  const request = (() => {
    seen.push(observe?.());
    return pending;
  }) as unknown as ApiMutationRequestFn;
  return { request, settle, fail, seen };
}

/** Drain the microtask queue (`onMutate` awaits `cancelQueries`). */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function trackingGate(): MutationGate & { begun: number; ended: number } {
  const gate = {
    begun: 0,
    ended: 0,
    begin() {
      gate.begun += 1;
    },
    end() {
      gate.ended += 1;
    },
  };
  return gate;
}

describe("useApiMutation — optimistic writes", () => {
  it("puts the optimistic row in the cache before the request settles", async () => {
    const client = clientWith([{ id: "a", body: "first" }]);
    const { request, settle, seen } = deferredRequest(() => read(client));
    const observer = new MutationObserver(
      client,
      buildApiMutationOptions<{ body: string }, { row: Row }>(client, request, {
        request: () => ({ path: PATH, workspaceId: WORKSPACE }),
        optimistic: (draft) =>
          patchCache<Cache>(apiPathKey(PATH), (cache) =>
            cache
              ? { rows: [...cache.rows, { id: "pending:1", body: draft.body }] }
              : cache
          ),
        reconcile: (data) =>
          patchCache<Cache>(apiPathKey(PATH), (cache) =>
            cache
              ? {
                  rows: cache.rows.map((r) =>
                    r.id === "pending:1" ? data.row : r
                  ),
                }
              : cache
          ),
      })
    );

    const inFlight = observer.mutate({ body: "second" });
    await flush();
    expect((seen[0] as Cache).rows.map((r) => r.id)).toEqual(["a", "pending:1"]);
    expect(read(client)?.rows.map((r) => r.id)).toEqual(["a", "pending:1"]);
    expect(read(client)?.rows[1].body).toBe("second");

    settle({ row: { id: "real-1", body: "second" } });
    await inFlight;
    expect(read(client)?.rows.map((r) => r.id)).toEqual(["a", "real-1"]);
  });

  it("restores the pre-write cache verbatim when the request fails", async () => {
    const before: Row[] = [{ id: "a", body: "first" }];
    const client = clientWith(before);
    const snapshot = read(client);
    const { request, fail } = deferredRequest();
    const onError = vi.fn();
    const observer = new MutationObserver(
      client,
      buildApiMutationOptions<{ body: string }, { row: Row }>(client, request, {
        request: () => ({ path: PATH, workspaceId: WORKSPACE }),
        optimistic: (draft) =>
          patchCache<Cache>(apiPathKey(PATH), (cache) =>
            cache
              ? { rows: [...cache.rows, { id: "pending:1", body: draft.body }] }
              : cache
          ),
        onError,
      })
    );

    const inFlight = observer.mutate({ body: "second" }).catch(() => "rejected");
    await flush();
    expect(read(client)?.rows).toHaveLength(2);

    fail(new Error("network"));
    await inFlight;
    expect(read(client)).toEqual(snapshot);
    expect(read(client)?.rows).toEqual(before);
    expect(onError).toHaveBeenCalledOnce();
  });

  it("patches EVERY variant of a path, and rolls each of them back", async () => {
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const archived = apiQueryKey(PATH, {
      workspaceId: WORKSPACE,
      query: { include: "archived" },
    });
    client.setQueryData(KEY, { rows: [] } satisfies Cache);
    client.setQueryData(archived, { rows: [] } satisfies Cache);
    const { request, fail } = deferredRequest();
    const observer = new MutationObserver(
      client,
      buildApiMutationOptions<void, unknown>(client, request, {
        request: () => ({ path: PATH }),
        // ⚠ Prefix key: a writer does not know which variants a reader mounted.
        optimistic: () =>
          patchCache<Cache>(apiPathKey(PATH), (cache) =>
            cache ? { rows: [{ id: "pending:1", body: "x" }] } : cache
          ),
      })
    );

    const inFlight = observer.mutate().catch(() => "rejected");
    await flush();
    expect(client.getQueryData<Cache>(KEY)?.rows).toHaveLength(1);
    expect(client.getQueryData<Cache>(archived)?.rows).toHaveLength(1);

    fail(new Error("nope"));
    await inFlight;
    expect(client.getQueryData<Cache>(KEY)?.rows).toHaveLength(0);
    expect(client.getQueryData<Cache>(archived)?.rows).toHaveLength(0);
  });

  it("cancels an in-flight read that HAS data, and spares a first load", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const cancel = vi.spyOn(client, "cancelQueries");
    const loaded = apiQueryKey(PATH, { workspaceId: "loaded" });
    const firstLoad = apiQueryKey(PATH, { workspaceId: "cold" });
    client.setQueryData(loaded, { rows: [] } satisfies Cache);
    const request = (async () => ({})) as ApiMutationRequestFn;
    await new MutationObserver(
      client,
      buildApiMutationOptions<void, unknown>(client, request, {
        request: () => ({ path: PATH }),
        optimistic: () =>
          patchCache<Cache>(apiPathKey(PATH), (cache) =>
            cache ? { rows: [{ id: "pending:1", body: "x" }] } : cache
          ),
      })
    ).mutate();

    const filters = cancel.mock.calls[0][0] as {
      predicate: (q: { state: { data: unknown } }) => boolean;
    };
    // ⚠ A first load has nothing to clobber; cancelling it leaves the surface
    // empty with nothing scheduled to fill it.
    expect(filters.predicate({ state: { data: { rows: [] } } })).toBe(true);
    expect(filters.predicate({ state: { data: undefined } })).toBe(false);
    expect(client.getQueryData(firstLoad)).toBeUndefined();
  });

  it("opens and closes the realtime gate exactly once, success or failure", async () => {
    const okGate = trackingGate();
    const failGate = trackingGate();
    const client = clientWith([]);

    const ok = deferredRequest();
    const okRun = new MutationObserver(
      client,
      buildApiMutationOptions<void, unknown>(client, ok.request, {
        request: () => ({ path: PATH }),
        settleWith: okGate,
      })
    ).mutate();
    expect(okGate.begun).toBe(1);
    expect(okGate.ended).toBe(0);
    ok.settle({});
    await okRun;
    expect(okGate.ended).toBe(1);

    const bad = deferredRequest();
    const badRun = new MutationObserver(
      client,
      buildApiMutationOptions<void, unknown>(client, bad.request, {
        request: () => ({ path: PATH }),
        settleWith: failGate,
      })
    )
      .mutate()
      .catch(() => "rejected");
    bad.fail(new Error("nope"));
    await badRun;
    expect(failGate.begun).toBe(1);
    expect(failGate.ended).toBe(1);
  });

  it("sends the request the config describes, defaulting to POST", async () => {
    const client = clientWith([]);
    const request = vi.fn(async () => ({ ok: true })) as ApiMutationRequestFn;
    await new MutationObserver(
      client,
      buildApiMutationOptions<{ id: string }, unknown>(client, request, {
        request: (draft) => ({
          path: `${PATH}/${draft.id}`,
          workspaceId: WORKSPACE,
          body: { name: "x" },
        }),
      })
    ).mutate({ id: "7" });
    expect(request).toHaveBeenCalledWith("/api/things/7", {
      method: "POST",
      body: { name: "x" },
      workspaceId: WORKSPACE,
      query: undefined,
      expectedUpdatedAt: undefined,
    });
  });

  it("invalidates only the keys the config names", async () => {
    const client = clientWith([]);
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const request = (async () => ({})) as ApiMutationRequestFn;
    await new MutationObserver(
      client,
      buildApiMutationOptions<void, unknown>(client, request, {
        request: () => ({ path: PATH }),
        invalidate: () => [apiPathKey("/api/other")],
      })
    ).mutate();
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/other"] });
  });
});
