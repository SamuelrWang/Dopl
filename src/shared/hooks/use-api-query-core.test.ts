/**
 * F-163 — the option-forwarding contract, asserted against what TanStack
 * ACTUALLY RESOLVES, not what the hook appears to pass.
 *
 * ⚠ A "was the option forwarded?" test cannot catch this: `staleTime:
 * opts.staleTime` DID forward, including the `undefined` of every caller that
 * named nothing, and spread-merge made that `undefined` beat
 * `QUERY_DEFAULT_OPTIONS.staleTime`.
 *
 * Both assertion kinds are required:
 *   1. `defaultQueryOptions()` — the RESOLVED value, the only place the default
 *      can be proven to survive the merge.
 *   2. `QueryObserver` — the CONSEQUENCE. ⚠ `0` is the trap: falsy, and treating
 *      it as "unset" hands a 30s cache to callers that explicitly refused one.
 */

import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  QUERY_CACHE_MAX_AGE_MS,
  QUERY_DEFAULT_OPTIONS,
} from "@/shared/api/query-defaults";
import { apiQueryKey } from "@/shared/api/query-keys";
import {
  buildApiQueryOptions,
  type ApiRequestFn,
  type UseApiQueryOpts,
} from "./use-api-query-core";

const PATH = "/api/things";
const DEFAULT_STALE_TIME = QUERY_DEFAULT_OPTIONS.queries?.staleTime;

interface Body {
  ok: boolean;
}

/** ⚠ REAL app defaults — the same object web `QueryProvider` and the SPA's
 *  `createQueryClient` both mount. */
const appClient = () => new QueryClient({ defaultOptions: QUERY_DEFAULT_OPTIONS });

const okRequest: ApiRequestFn = (async () => ({ ok: true })) as ApiRequestFn;

/** What TanStack runs with: client default merged with the hook's options. */
function resolved(opts: UseApiQueryOpts<Body> = {}, client = appClient()) {
  return client.defaultQueryOptions(
    buildApiQueryOptions<Body>(okRequest, PATH, opts)
  );
}

describe("the client default survives an unspecified option", () => {
  it("resolves staleTime to the app default when the caller names none", () => {
    // ⚠ Checking "staleTime was passed through" would NOT catch F-163: it was,
    // as `undefined`, which is precisely what deleted the default.
    expect(DEFAULT_STALE_TIME).toBe(30_000);
    expect(resolved().staleTime).toBe(DEFAULT_STALE_TIME);
    expect(resolved().staleTime).not.toBeUndefined();
    expect(resolved().staleTime).not.toBe(0);
  });

  it("omits every unnamed option from the object entirely", () => {
    // ⚠ Structural half: a key present with value `undefined` overrides the
    // default; only ABSENCE falls through. Holds for every option.
    const built = buildApiQueryOptions<Body>(okRequest, PATH, {});

    expect("staleTime" in built).toBe(false);
    expect("select" in built).toBe(false);
    expect("refetchInterval" in built).toBe(false);
    expect("placeholderData" in built).toBe(false);
  });

  it("leaves the rest of the default policy intact", () => {
    // ⚠ gcTime must stay >= the persisted cache's maxAge or restored entries are
    // collected before use (query-defaults.ts); the retry predicate stops 4xx
    // retries.
    expect(resolved().gcTime).toBe(QUERY_CACHE_MAX_AGE_MS);
    expect(typeof resolved().retry).toBe("function");
  });
});

describe("an explicit option still wins", () => {
  it("takes a caller's staleTime over the default", () => {
    expect(resolved({ staleTime: 5_000 }).staleTime).toBe(5_000);
  });

  it("takes an explicit 0 — falsy is not unset", () => {
    expect(resolved({ staleTime: 0 }).staleTime).toBe(0);
  });

  it("forwards the options a caller does name", () => {
    const select = (body: Body) => body.ok;
    const built = buildApiQueryOptions<Body, boolean>(okRequest, PATH, {
      select,
      refetchInterval: 30_000,
      keepPreviousData: true,
    });

    expect(built.select).toBe(select);
    expect(built.refetchInterval).toBe(30_000);
    expect(built.placeholderData).toBeDefined();
  });
});

/** Subscribe like a mounting component; report whether the query fetched. */
async function fetchesOnSubscribe(
  client: QueryClient,
  request: ApiRequestFn,
  opts: UseApiQueryOpts<Body> = {}
): Promise<void> {
  const observer = new QueryObserver(
    client,
    buildApiQueryOptions<Body>(request, PATH, opts)
  );
  const unsubscribe = observer.subscribe(() => {});
  // ⚠ One macrotask: enough for notifyManager to flush the mount dispatch.
  await new Promise((r) => setTimeout(r, 0));
  unsubscribe();
}

describe("what that means on a mount", () => {
  it("serves a fresh cache entry without refetching it", async () => {
    const client = appClient();
    // Inside the 30s window. Under F-163 this refetched anyway.
    client.setQueryData(apiQueryKey(PATH), { ok: true });
    const request = vi.fn(async () => ({ ok: true })) as unknown as ApiRequestFn;

    await fetchesOnSubscribe(client, request);

    expect(request).not.toHaveBeenCalled();
  });

  it("still refetches that entry when the caller asked for staleTime 0", async () => {
    const client = appClient();
    client.setQueryData(apiQueryKey(PATH), { ok: true });
    const request = vi.fn(async () => ({ ok: true })) as unknown as ApiRequestFn;

    await fetchesOnSubscribe(client, request, { staleTime: 0 });

    expect(request).toHaveBeenCalledTimes(1);
  });

  it("refetches an entry older than the default staleTime", async () => {
    const client = appClient();
    client.setQueryData(apiQueryKey(PATH), { ok: true }, {
      updatedAt: Date.now() - 31_000,
    });
    const request = vi.fn(async () => ({ ok: true })) as unknown as ApiRequestFn;

    await fetchesOnSubscribe(client, request);

    // Persisted-cache case: a restored entry's `dataUpdatedAt` predates the
    // process exit, so it is stale on arrival. Stale-WHILE-revalidate.
    expect(request).toHaveBeenCalledTimes(1);
  });
});
