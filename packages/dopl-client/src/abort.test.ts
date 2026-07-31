/**
 * Q14 — CALLER CANCELLATION REACHES THE SOCKET.
 *
 * The behaviour under test is a cost control, not a feature: without it, an MCP
 * client hanging up mid-`op="await"` left the hold re-issuing ~50s loopback
 * polls for its remaining ~215s budget, each one a fresh 60s function doing its
 * own Supabase work for a caller that was already gone.
 *
 * Three properties are pinned, and each one is a separate way to lose the fix:
 *   1. an aborted signal STOPS THE LOOP — no further fetch is opened, and the
 *      retry budget is not spent re-trying a request nobody is waiting for;
 *   2. an abort is reported as `DoplAbortError`, never `DoplTimeoutError` —
 *      both arrive from `fetch` as an AbortError, and mislabelling a client
 *      disconnect as "timed out after 55000ms" sends the next reader hunting a
 *      slow route that was never slow;
 *   3. listeners are DETACHED — the external signal outlives the request and a
 *      215s hold links it once per poll, so a leak here is unbounded.
 *
 * And one property that is a DELIBERATE LIMIT rather than a feature: a MUTATION
 * already on the wire is never interrupted. Killing the loopback also kills the
 * inner route mid-write, and the thread-create path is not yet atomic, so the
 * saving (one short in-flight POST per cancelled call) is not worth minting
 * half-built rows. Cancellation still stops a mutation from being STARTED,
 * which is free because nothing has been sent.
 */

import { getEventListeners } from "node:events";
import { afterEach, describe, expect, it } from "vitest";

import { anyAborted, linkAbort } from "./abort.js";
import { DoplClient } from "./client.js";
import { DoplAbortError, DoplTimeoutError } from "./errors.js";
import { DoplTransport } from "./transport.js";

const BASE = "https://api.example.test";

type FetchArgs = Parameters<typeof fetch>;

interface StubbedFetch {
  signals: Array<AbortSignal | undefined>;
  calls: number;
  restore: () => void;
}

/** Records the signal handed to each fetch; `respond` decides the outcome. */
function stubFetch(
  respond: (signal: AbortSignal | undefined) => Promise<Response>
): StubbedFetch {
  const original = global.fetch;
  const state: StubbedFetch = {
    signals: [],
    calls: 0,
    restore: () => {
      global.fetch = original;
    },
  };
  global.fetch = (async (...args: FetchArgs) => {
    const init = args[1] ?? {};
    state.calls += 1;
    state.signals.push(init.signal ?? undefined);
    return respond(init.signal ?? undefined);
  }) as typeof fetch;
  return state;
}

/** Never resolves on its own — only the passed signal can end it. */
function pendingUntilAborted(signal: AbortSignal | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener(
      "abort",
      () => reject(new DOMException("aborted", "AbortError")),
      { once: true }
    );
  });
}

describe("linkAbort / anyAborted", () => {
  it("aborts the controller when an external signal fires, forwarding the reason", () => {
    const controller = new AbortController();
    const external = new AbortController();
    linkAbort(controller, [external.signal]);
    expect(controller.signal.aborted).toBe(false);
    external.abort("client hung up");
    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBe("client hung up");
  });

  it("aborts synchronously when the external signal is ALREADY aborted", () => {
    // The pre-aborted case is the one a poll loop hits on every iteration after
    // the first, so it must not need a turn of the event loop to take effect.
    const external = new AbortController();
    external.abort();
    const controller = new AbortController();
    linkAbort(controller, [external.signal]);
    expect(controller.signal.aborted).toBe(true);
  });

  it("takes whichever of several signals fires first", () => {
    const a = new AbortController();
    const b = new AbortController();
    const controller = new AbortController();
    linkAbort(controller, [a.signal, undefined, b.signal]);
    b.abort("second one");
    expect(controller.signal.reason).toBe("second one");
  });

  it("detach removes every listener, and a later abort is inert", () => {
    const external = new AbortController();
    const controller = new AbortController();
    const detach = linkAbort(controller, [external.signal]);
    expect(getEventListeners(external.signal, "abort")).toHaveLength(1);
    detach();
    expect(getEventListeners(external.signal, "abort")).toHaveLength(0);
    external.abort();
    expect(controller.signal.aborted).toBe(false);
  });

  it("anyAborted ignores undefined slots", () => {
    const live = new AbortController();
    expect(anyAborted([undefined, live.signal])).toBe(false);
    live.abort();
    expect(anyAborted([undefined, live.signal])).toBe(true);
  });
});

describe("DoplTransport — caller cancellation", () => {
  let stub: StubbedFetch | undefined;
  afterEach(() => {
    stub?.restore();
    stub = undefined;
  });

  it("an already-aborted transport signal makes ZERO fetches", async () => {
    stub = stubFetch(async () => new Response("{}", { status: 200 }));
    const external = new AbortController();
    external.abort();
    const client = new DoplClient(BASE, "k", { signal: external.signal });
    await expect(client.listClusters()).rejects.toBeInstanceOf(DoplAbortError);
    expect(stub.calls).toBe(0);
  });

  it("an abort mid-flight raises DoplAbortError, not DoplTimeoutError", async () => {
    // Both come back from fetch as an AbortError. Only the external signal's
    // state tells them apart, which is exactly what the transport now reads.
    const external = new AbortController();
    stub = stubFetch((signal) => {
      setTimeout(() => external.abort(), 0);
      return pendingUntilAborted(signal);
    });
    const client = new DoplClient(BASE, "k", { signal: external.signal });
    const err = await client.listClusters().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DoplAbortError);
    expect(err).not.toBeInstanceOf(DoplTimeoutError);
    expect(String((err as Error).message)).toContain("aborted by the caller");
  });

  it("spends NO retry budget after an abort, on a retriable GET", async () => {
    // The load-bearing count. listClusters is a GET, so the retry budget is
    // live; before the fix a mid-hold abort burned every remaining attempt
    // (each with a backoff sleep) against a caller that had already gone.
    const external = new AbortController();
    stub = stubFetch((signal) => {
      setTimeout(() => external.abort(), 0);
      return pendingUntilAborted(signal);
    });
    const client = new DoplClient(BASE, "k", { signal: external.signal });
    await expect(client.listClusters()).rejects.toBeInstanceOf(DoplAbortError);
    expect(stub.calls).toBe(1);
  });

  it("a per-call signal aborts one request without touching the transport", async () => {
    const perCall = new AbortController();
    stub = stubFetch((signal) => {
      setTimeout(() => perCall.abort(), 0);
      return pendingUntilAborted(signal);
    });
    const transport = new DoplTransport(BASE, "k");
    await expect(
      transport.request("/api/clusters", { signal: perCall.signal })
    ).rejects.toBeInstanceOf(DoplAbortError);
    expect(stub.calls).toBe(1);
  });

  it("leaves NO listener on the caller's signal after a completed request", async () => {
    // A 215s await hold links the SAME Request.signal once per poll. Without
    // teardown those accumulate for the life of the function.
    stub = stubFetch(
      async () => new Response(JSON.stringify({ clusters: [] }), { status: 200 })
    );
    const external = new AbortController();
    const client = new DoplClient(BASE, "k", { signal: external.signal });
    for (let i = 0; i < 5; i++) await client.listClusters();
    expect(getEventListeners(external.signal, "abort")).toHaveLength(0);
  });

  it("refuses to START a mutation once the caller is gone", async () => {
    stub = stubFetch(async () => new Response("{}", { status: 200 }));
    const external = new AbortController();
    external.abort();
    const client = new DoplClient(BASE, "k", { signal: external.signal });
    await expect(client.createCluster("x")).rejects.toBeInstanceOf(DoplAbortError);
    expect(stub.calls).toBe(0);
  });

  it("does NOT interrupt a mutation that is already on the wire", async () => {
    // The deliberate limit. A POST killed mid-flight kills the inner route
    // mid-write, and thread creation is not atomic yet — a half-built row is
    // worse than one wasted short request.
    const external = new AbortController();
    let signalSeenByFetch: AbortSignal | undefined;
    stub = stubFetch(async (signal) => {
      signalSeenByFetch = signal;
      external.abort();
      await new Promise((r) => setTimeout(r, 5));
      return new Response(JSON.stringify({ id: "c1" }), { status: 200 });
    });
    const client = new DoplClient(BASE, "k", { signal: external.signal });
    await expect(client.createCluster("x")).resolves.toEqual({ id: "c1" });
    expect(signalSeenByFetch?.aborted).toBe(false);
  });

  it("an unset signal changes nothing — timeouts still read as timeouts", async () => {
    stub = stubFetch(async () => {
      throw new DOMException("aborted", "AbortError");
    });
    const client = new DoplClient(BASE, "k");
    const err = await client.createCluster("x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DoplTimeoutError);
    expect(err).not.toBeInstanceOf(DoplAbortError);
  });
});
