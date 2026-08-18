"use strict";
/**
 * CALLER CANCELLATION for `DoplTransport` (Q14).
 *
 * A request's own `timeoutMs` controller covers "server too slow", not "caller
 * is gone" — the expensive case: the in-app MCP route
 * (`src/app/api/mcp/route.ts`) runs a `dopl_channel(op="await")` hold that
 * re-issues a ~50s loopback poll for up to ~215s. Nothing downstream learns of
 * a hang-up (ESC in Claude Code), so the hold keeps burning fresh 60s functions
 * for its remaining budget. Letting an EXTERNAL signal (the incoming
 * `Request.signal`) reach the fetch aborts the in-flight poll and stops the
 * next opening.
 *
 * ⚠ NOT `AbortSignal.any()`: it lands in Node 20.3, and this package declares
 * `engines.node >= 18.17` and is bundled into the desktop app. The manual link
 * below is the same semantics plus explicit teardown, which is needed anyway —
 * a 215s hold attaches one listener per poll to the SAME `Request.signal`, and
 * without `detach()` they accumulate for the life of the function.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.anyAborted = anyAborted;
exports.linkAbort = linkAbort;
const NO_OP = () => { };
/** True when any of the supplied signals has already aborted. */
function anyAborted(signals) {
    return signals.some((signal) => signal?.aborted === true);
}
/**
 * Abort `controller` as soon as any of `signals` aborts, forwarding the reason
 * so the `DOMException` carries the caller's own cause. An already-aborted
 * signal aborts synchronously and returns a no-op detach.
 */
function linkAbort(controller, signals) {
    const attached = [];
    const detach = () => {
        for (const link of attached) {
            link.signal.removeEventListener("abort", link.onAbort);
        }
        attached.length = 0;
    };
    for (const signal of signals) {
        if (!signal)
            continue;
        if (signal.aborted) {
            controller.abort(signal.reason);
            detach();
            return NO_OP;
        }
        const onAbort = () => controller.abort(signal.reason);
        signal.addEventListener("abort", onAbort, { once: true });
        attached.push({ signal, onAbort });
    }
    return attached.length > 0 ? detach : NO_OP;
}
