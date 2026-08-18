"use strict";
/**
 * Q14 — CALLER CANCELLATION REACHES THE SOCKET. A cost control: without it, an
 * MCP client hanging up mid-`op="await"` left the hold re-issuing ~50s loopback
 * polls for its remaining ~215s budget.
 *
 * Three pinned properties, each a separate way to lose the fix:
 *   1. an aborted signal STOPS THE LOOP — no further fetch, no retry budget
 *      spent on a request nobody is waiting for;
 *   2. reported as `DoplAbortError`, never `DoplTimeoutError` — both arrive
 *      from `fetch` as AbortError, and "timed out after 55000ms" sends the next
 *      reader hunting a slow route that was never slow;
 *   3. listeners DETACHED — the external signal outlives the request and a 215s
 *      hold links it once per poll, so a leak is unbounded.
 *
 * Plus one DELIBERATE LIMIT: a MUTATION already on the wire is never
 * interrupted — killing the loopback kills the inner route mid-write and
 * thread-create is not atomic, so one wasted short POST beats a half-built row.
 * Cancellation still stops a mutation from being STARTED.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const node_events_1 = require("node:events");
const vitest_1 = require("vitest");
const abort_js_1 = require("./abort.js");
const client_js_1 = require("./client.js");
const errors_js_1 = require("./errors.js");
const transport_js_1 = require("./transport.js");
const BASE = "https://api.example.test";
/** Records the signal handed to each fetch; `respond` decides the outcome. */
function stubFetch(respond) {
    const original = global.fetch;
    const state = {
        signals: [],
        calls: 0,
        restore: () => {
            global.fetch = original;
        },
    };
    global.fetch = (async (...args) => {
        const init = args[1] ?? {};
        state.calls += 1;
        state.signals.push(init.signal ?? undefined);
        return respond(init.signal ?? undefined);
    });
    return state;
}
/** Never resolves on its own — only the passed signal can end it. */
function pendingUntilAborted(signal) {
    return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    });
}
(0, vitest_1.describe)("linkAbort / anyAborted", () => {
    (0, vitest_1.it)("aborts the controller when an external signal fires, forwarding the reason", () => {
        const controller = new AbortController();
        const external = new AbortController();
        (0, abort_js_1.linkAbort)(controller, [external.signal]);
        (0, vitest_1.expect)(controller.signal.aborted).toBe(false);
        external.abort("client hung up");
        (0, vitest_1.expect)(controller.signal.aborted).toBe(true);
        (0, vitest_1.expect)(controller.signal.reason).toBe("client hung up");
    });
    (0, vitest_1.it)("aborts synchronously when the external signal is ALREADY aborted", () => {
        // A poll loop hits the pre-aborted case on every iteration after the
        // first, so it must not need an event-loop turn to take effect.
        const external = new AbortController();
        external.abort();
        const controller = new AbortController();
        (0, abort_js_1.linkAbort)(controller, [external.signal]);
        (0, vitest_1.expect)(controller.signal.aborted).toBe(true);
    });
    (0, vitest_1.it)("takes whichever of several signals fires first", () => {
        const a = new AbortController();
        const b = new AbortController();
        const controller = new AbortController();
        (0, abort_js_1.linkAbort)(controller, [a.signal, undefined, b.signal]);
        b.abort("second one");
        (0, vitest_1.expect)(controller.signal.reason).toBe("second one");
    });
    (0, vitest_1.it)("detach removes every listener, and a later abort is inert", () => {
        const external = new AbortController();
        const controller = new AbortController();
        const detach = (0, abort_js_1.linkAbort)(controller, [external.signal]);
        (0, vitest_1.expect)((0, node_events_1.getEventListeners)(external.signal, "abort")).toHaveLength(1);
        detach();
        (0, vitest_1.expect)((0, node_events_1.getEventListeners)(external.signal, "abort")).toHaveLength(0);
        external.abort();
        (0, vitest_1.expect)(controller.signal.aborted).toBe(false);
    });
    (0, vitest_1.it)("anyAborted ignores undefined slots", () => {
        const live = new AbortController();
        (0, vitest_1.expect)((0, abort_js_1.anyAborted)([undefined, live.signal])).toBe(false);
        live.abort();
        (0, vitest_1.expect)((0, abort_js_1.anyAborted)([undefined, live.signal])).toBe(true);
    });
});
(0, vitest_1.describe)("DoplTransport — caller cancellation", () => {
    let stub;
    (0, vitest_1.afterEach)(() => {
        stub?.restore();
        stub = undefined;
    });
    (0, vitest_1.it)("an already-aborted transport signal makes ZERO fetches", async () => {
        stub = stubFetch(async () => new Response("{}", { status: 200 }));
        const external = new AbortController();
        external.abort();
        const client = new client_js_1.DoplClient(BASE, "k", { signal: external.signal });
        await (0, vitest_1.expect)(client.listWorkspaces()).rejects.toBeInstanceOf(errors_js_1.DoplAbortError);
        (0, vitest_1.expect)(stub.calls).toBe(0);
    });
    (0, vitest_1.it)("an abort mid-flight raises DoplAbortError, not DoplTimeoutError", async () => {
        const external = new AbortController();
        stub = stubFetch((signal) => {
            setTimeout(() => external.abort(), 0);
            return pendingUntilAborted(signal);
        });
        const client = new client_js_1.DoplClient(BASE, "k", { signal: external.signal });
        const err = await client.listWorkspaces().catch((e) => e);
        (0, vitest_1.expect)(err).toBeInstanceOf(errors_js_1.DoplAbortError);
        (0, vitest_1.expect)(err).not.toBeInstanceOf(errors_js_1.DoplTimeoutError);
        (0, vitest_1.expect)(String(err.message)).toContain("aborted by the caller");
    });
    (0, vitest_1.it)("spends NO retry budget after an abort, on a retriable GET", async () => {
        // The load-bearing count: listWorkspaces is a GET, so the retry budget is
        // live and a mid-hold abort must not burn the remaining attempts.
        const external = new AbortController();
        stub = stubFetch((signal) => {
            setTimeout(() => external.abort(), 0);
            return pendingUntilAborted(signal);
        });
        const client = new client_js_1.DoplClient(BASE, "k", { signal: external.signal });
        await (0, vitest_1.expect)(client.listWorkspaces()).rejects.toBeInstanceOf(errors_js_1.DoplAbortError);
        (0, vitest_1.expect)(stub.calls).toBe(1);
    });
    (0, vitest_1.it)("a per-call signal aborts one request without touching the transport", async () => {
        const perCall = new AbortController();
        stub = stubFetch((signal) => {
            setTimeout(() => perCall.abort(), 0);
            return pendingUntilAborted(signal);
        });
        const transport = new transport_js_1.DoplTransport(BASE, "k");
        await (0, vitest_1.expect)(transport.request("/api/workspaces", { signal: perCall.signal })).rejects.toBeInstanceOf(errors_js_1.DoplAbortError);
        (0, vitest_1.expect)(stub.calls).toBe(1);
    });
    (0, vitest_1.it)("leaves NO listener on the caller's signal after a completed request", async () => {
        // A 215s hold links the SAME Request.signal once per poll; without
        // teardown they accumulate for the life of the function.
        stub = stubFetch(async () => new Response(JSON.stringify({ workspaces: [] }), { status: 200 }));
        const external = new AbortController();
        const client = new client_js_1.DoplClient(BASE, "k", { signal: external.signal });
        for (let i = 0; i < 5; i++)
            await client.listWorkspaces();
        (0, vitest_1.expect)((0, node_events_1.getEventListeners)(external.signal, "abort")).toHaveLength(0);
    });
    (0, vitest_1.it)("refuses to START a mutation once the caller is gone", async () => {
        stub = stubFetch(async () => new Response("{}", { status: 200 }));
        const external = new AbortController();
        external.abort();
        const client = new client_js_1.DoplClient(BASE, "k", { signal: external.signal });
        await (0, vitest_1.expect)(client.createOntologyCluster({ name: "x" })).rejects.toBeInstanceOf(errors_js_1.DoplAbortError);
        (0, vitest_1.expect)(stub.calls).toBe(0);
    });
    (0, vitest_1.it)("does NOT interrupt a mutation that is already on the wire", async () => {
        const external = new AbortController();
        let signalSeenByFetch;
        stub = stubFetch(async (signal) => {
            signalSeenByFetch = signal;
            external.abort();
            await new Promise((r) => setTimeout(r, 5));
            return new Response(JSON.stringify({ cluster: { id: "c1" } }), { status: 200 });
        });
        const client = new client_js_1.DoplClient(BASE, "k", { signal: external.signal });
        await (0, vitest_1.expect)(client.createOntologyCluster({ name: "x" })).resolves.toEqual({ id: "c1" });
        (0, vitest_1.expect)(signalSeenByFetch?.aborted).toBe(false);
    });
    (0, vitest_1.it)("an unset signal changes nothing — timeouts still read as timeouts", async () => {
        stub = stubFetch(async () => {
            throw new DOMException("aborted", "AbortError");
        });
        const client = new client_js_1.DoplClient(BASE, "k");
        const err = await client.createOntologyCluster({ name: "x" }).catch((e) => e);
        (0, vitest_1.expect)(err).toBeInstanceOf(errors_js_1.DoplTimeoutError);
        (0, vitest_1.expect)(err).not.toBeInstanceOf(errors_js_1.DoplAbortError);
    });
});
