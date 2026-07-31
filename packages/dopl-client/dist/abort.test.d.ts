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
export {};
