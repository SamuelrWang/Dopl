/**
 * The shared TanStack retry rule: a network failure (offline, sleep/wake) is
 * retried with backoff; a 4xx never; everything else once, as before. Driven
 * through a real QueryClient mounted with the app's defaults.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { ApiError, NetworkError } from "./api-envelope";
import { NETWORK_RETRY_LIMIT, QUERY_DEFAULT_OPTIONS } from "./query-defaults";

const retry = QUERY_DEFAULT_OPTIONS.queries!.retry as (n: number, e: unknown) => boolean;
const retryDelay = QUERY_DEFAULT_OPTIONS.queries!.retryDelay as (n: number, e: unknown) => number;

afterEach(() => {
  vi.useRealTimers();
});

describe("retry predicate", () => {
  it("retries a network failure NETWORK_RETRY_LIMIT times", () => {
    const err = new NetworkError();
    const answers = [0, 1, 2, 3, 4].map((n) => retry(n, err));
    expect(NETWORK_RETRY_LIMIT).toBe(3);
    expect(answers).toEqual([true, true, true, false, false]);
  });

  it("recognises a feature client's re-wrap of a network failure", () => {
    const rewrap = Object.assign(new Error("x"), { status: 0, code: "NETWORK_TIMEOUT" });
    expect(retry(2, rewrap)).toBe(true);
  });

  it("never retries a 4xx", () => {
    for (const status of [400, 401, 403, 404, 409, 412]) {
      expect(retry(0, new ApiError(status, "X", "x"))).toBe(false);
    }
  });

  it("retries a 5xx, a status-less error and a bridge failure exactly once (unchanged)", () => {
    for (const err of [new ApiError(503, "X", "x"), new Error("boom"), new ApiError(0, "BRIDGE_FAILURE", "x")]) {
      expect([retry(0, err), retry(1, err)]).toEqual([true, false]);
    }
  });

  it("backs a network failure off 1s → 2s → 4s, capped at 8s; others keep TanStack's curve", () => {
    const net = new NetworkError();
    expect([0, 1, 2, 3, 4].map((n) => retryDelay(n, net))).toEqual([1000, 2000, 4000, 8000, 8000]);
    expect(retryDelay(5, new Error("x"))).toBe(30_000);
    expect(retryDelay(1, new Error("x"))).toBe(2000);
  });
});

describe("through a real QueryClient", () => {
  it("rides out three network failures and lands the answer", async () => {
    vi.useFakeTimers();
    const client = new QueryClient({ defaultOptions: QUERY_DEFAULT_OPTIONS });
    let calls = 0;
    const pending = client.fetchQuery({
      queryKey: ["probe"],
      queryFn: async () => {
        calls += 1;
        if (calls <= 3) throw new NetworkError();
        return "ok";
      },
    });
    await vi.advanceTimersByTimeAsync(1000 + 2000 + 4000);
    await expect(pending).resolves.toBe("ok");
    expect(calls).toBe(4);
  });

  it("a 4xx fails on the first answer", async () => {
    const client = new QueryClient({ defaultOptions: QUERY_DEFAULT_OPTIONS });
    let calls = 0;
    await expect(
      client.fetchQuery({
        queryKey: ["probe-4xx"],
        queryFn: async () => {
          calls += 1;
          throw new ApiError(404, "NOT_FOUND", "Not found");
        },
      })
    ).rejects.toBeInstanceOf(ApiError);
    expect(calls).toBe(1);
  });
});
