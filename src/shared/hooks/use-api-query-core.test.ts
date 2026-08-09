/**
 * F-163 — the option-forwarding contract, asserted against what TanStack
 * ACTUALLY RESOLVES rather than what the hook appears to pass.
 *
 * The bug this pins was invisible to any test that checked "the option is
 * forwarded": `staleTime: opts.staleTime` DID forward, faithfully, including
 * the `undefined` of every caller that named nothing. TanStack merges options
 * by spread, so that `undefined` won over `QUERY_DEFAULT_OPTIONS.staleTime`
 * and the app's documented 30s policy was inert on both clients for every read
 * in the product.
 *
 * So the assertions here are of two kinds and both are required:
 *   1. `defaultQueryOptions()` — the RESOLVED value a query runs with. This is
 *      the merge the bug lived in, so it is the only place the default can be
 *      proven to survive.
 *   2. `QueryObserver` — the CONSEQUENCE. A fresh cache entry must not be
 *      refetched on subscribe, and an explicit `staleTime: 0` must still force
 *      one. `0` is the trap: it is falsy, and treating it as "unset" would
 *      silently hand the consent inbox / invite link / channel transcript a
 *      30s cache they explicitly refused.
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

/** A client carrying the REAL app defaults — the same object the web
 *  `QueryProvider` and the desktop SPA's `createQueryClient` both mount. */
const appClient = () => new QueryClient({ defaultOptions: QUERY_DEFAULT_OPTIONS });

const okRequest: ApiRequestFn = (async () => ({ ok: true })) as ApiRequestFn;

/** What TanStack runs the query with: the client default merged with the
 *  hook's options. */
function resolved(opts: UseApiQueryOpts<Body> = {}, client = appClient()) {
  return client.defaultQueryOptions(
    buildApiQueryOptions<Body>(okRequest, PATH, opts)
  );
}

describe("the client default survives an unspecified option", () => {
  it("resolves staleTime to the app default when the caller names none", () => {
    // The assertion that would have caught F-163. Checking "staleTime was
    // passed through" would not have: it was, as `undefined`, which is
    // precisely what deleted the default.
    expect(DEFAULT_STALE_TIME).toBe(30_000);
    expect(resolved().staleTime).toBe(DEFAULT_STALE_TIME);
    // Spelled out, because these are the two values the bug produced.
    expect(resolved().staleTime).not.toBeUndefined();
    expect(resolved().staleTime).not.toBe(0);
  });

  it("omits every unnamed option from the object entirely", () => {
    // The structural half. A key present with value `undefined` overrides the
    // default; only ABSENCE falls through. This holds the fix in place for
    // every option, not just the one that was reported.
    const built = buildApiQueryOptions<Body>(okRequest, PATH, {});

    expect("staleTime" in built).toBe(false);
    expect("select" in built).toBe(false);
    expect("refetchInterval" in built).toBe(false);
    expect("placeholderData" in built).toBe(false);
  });

  it("leaves the rest of the default policy intact", () => {
    // gcTime must stay >= the persisted cache's maxAge or restored entries are
    // collected before they can be used (query-defaults.ts), and the retry
    // predicate is what stops 4xx being retried.
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

/** Subscribe an observer the way a mounting component does, and report whether
 *  the query fetched. */
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
  // One macrotask: enough for notifyManager to flush the mount dispatch.
  await new Promise((r) => setTimeout(r, 0));
  unsubscribe();
}

describe("what that means on a mount", () => {
  it("serves a fresh cache entry without refetching it", async () => {
    const client = appClient();
    // Written now — inside the 30s window. Under F-163 this refetched anyway,
    // which is how the bug was found: the boot answer was seeded into the
    // shell's key and re-fetched one commit later regardless.
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

    // The persisted-cache case: a relaunch restores an entry whose
    // `dataUpdatedAt` predates the process exit, so it is stale on arrival and
    // revalidates. Caching is stale-WHILE-revalidate, not stale-instead-of.
    expect(request).toHaveBeenCalledTimes(1);
  });
});
