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
export {};
