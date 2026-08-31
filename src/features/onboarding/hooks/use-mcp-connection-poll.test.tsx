// @vitest-environment jsdom
/**
 * A CADENCE SHORTER THAN THE REQUEST TIMEOUT, WITH NO IN-FLIGHT GUARD, IS AN AMPLIFIER
 * (2026-08-30, the desktop abort-churn incident).
 *
 * WHAT THIS POLL DOES AND WHERE IT RUNS. `ConnectAgentBanner` mounts it on EVERY
 * workspace page, and — this is the part that matters — an ERRORED status query counts as
 * "loaded" (`fail-open: failed status fetch still shows banner; live poll retries`), so
 * the incident state is precisely the state that ENABLES the poll. On the desktop it
 * rides the IPC transport, whose main-process timeout is 30s (`ui-bridge.js ›
 * REQUEST_TIMEOUT_MS`).
 *
 * THE OLD SHAPE was `setInterval(check, 3500)` with `void check()` — fired whether or not
 * the previous request had settled, swallowed every failure with "next tick retries", and
 * never backed off. Against a slow or saturated API that is ~9 doomed requests in flight
 * at once, per window, forever, each holding a socket in main until it aborted: the sicker
 * the server, the more load it gets.
 *
 * TWO PROPERTIES, and neither is sufficient alone:
 *   1. self-scheduling from the SETTLEMENT — the effective period becomes
 *      `max(interval, request duration)` and at most one request is ever in flight;
 *   2. BACKOFF on consecutive failures — an in-flight guard alone still hammers a server
 *      that fails FAST, which a 401 storm does.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

const apiRequest = vi.fn();
vi.mock("@/shared/api/api-client", () => ({
  apiRequest: (...args: unknown[]) => apiRequest(...args),
}));

const { useMcpConnectionPoll } = await import("./use-mcp-connection-poll");

/** A request that never settles — a hung/aborting transport. */
const hang = () => new Promise(() => {});

// ⚠ NOT `waitFor`: it runs on REAL timers and would hang the whole suite under
// `vi.useFakeTimers()`. Advancing inside `act` is what lets the hook's state updates
// flush the way React expects.
const tick = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  vi.useFakeTimers();
  apiRequest.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useMcpConnectionPoll", () => {
  it("never has two requests in flight — a hung read delays the next, it does not stack", async () => {
    apiRequest.mockImplementation(hang);
    renderHook(() => useMcpConnectionPoll(true));

    await tick(60_000); // > 17 old intervals
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it("backs off on consecutive FAILURES instead of retrying at the base rate forever", async () => {
    apiRequest.mockRejectedValue(new Error("boom"));
    renderHook(() => useMcpConnectionPoll(true));

    // First attempt is immediate.
    await tick(0);
    expect(apiRequest).toHaveBeenCalledTimes(1);
    // The FIRST failure keeps today's 3.5s — a blip must still recover fast.
    await tick(3_500);
    expect(apiRequest).toHaveBeenCalledTimes(2);
    // The second earns 7s, so 3.5 more is NOT enough…
    await tick(3_500);
    expect(apiRequest).toHaveBeenCalledTimes(2);
    await tick(3_500);
    expect(apiRequest).toHaveBeenCalledTimes(3);
  });

  it("the backoff has a CEILING — an all-day outage does not become an all-day silence", async () => {
    apiRequest.mockRejectedValue(new Error("boom"));
    renderHook(() => useMcpConnectionPoll(true));
    await tick(0);

    await tick(10 * 60_000);
    const afterTenMinutes = apiRequest.mock.calls.length;
    await tick(10 * 60_000);
    // Still polling (it must recover on its own), but at the 60s ceiling, so the second
    // ten minutes buys roughly ten more attempts — not hundreds.
    const added = apiRequest.mock.calls.length - afterTenMinutes;
    expect(added).toBeGreaterThan(5);
    expect(added).toBeLessThanOrEqual(12);
  });

  it("a SUCCESS resets the ladder — a backoff that only climbs is a give-up", async () => {
    apiRequest.mockRejectedValueOnce(new Error("boom"));
    apiRequest.mockRejectedValueOnce(new Error("boom"));
    apiRequest.mockRejectedValueOnce(new Error("boom"));
    apiRequest.mockResolvedValue({ connected: false });
    renderHook(() => useMcpConnectionPoll(true));

    await tick(60_000);
    const beforeReset = apiRequest.mock.calls.length;
    // Back at the 3.5s base: two more ticks inside 8s.
    await tick(8_000);
    expect(apiRequest.mock.calls.length - beforeReset).toBeGreaterThanOrEqual(2);
  });

  it("stops for good once connected, and does not poll at all when disabled", async () => {
    apiRequest.mockResolvedValue({ connected: true });
    const { result } = renderHook(() => useMcpConnectionPoll(true));
    await tick(0);
    expect(result.current).toBe(true);
    const atConnect = apiRequest.mock.calls.length;
    await tick(60_000);
    expect(apiRequest).toHaveBeenCalledTimes(atConnect);

    apiRequest.mockReset();
    renderHook(() => useMcpConnectionPoll(false));
    await tick(60_000);
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it("unmounting cancels the chain — a closed banner must not keep asking", async () => {
    apiRequest.mockResolvedValue({ connected: false });
    const { unmount } = renderHook(() => useMcpConnectionPoll(true));
    await tick(0);
    expect(apiRequest).toHaveBeenCalledTimes(1);
    unmount();
    await tick(60_000);
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });
});
