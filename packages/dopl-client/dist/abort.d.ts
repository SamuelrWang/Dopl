/**
 * CALLER CANCELLATION for `DoplTransport` (Q14, 2026-07-31).
 *
 * Every request already builds its own `AbortController` from `timeoutMs`.
 * That covers "the server is too slow"; it does NOT cover "the caller is gone",
 * which is the expensive case: the in-app MCP route (`src/app/api/mcp/route.ts`)
 * runs a `dopl_channel(op="await")` hold that re-issues a ~50s loopback poll for
 * up to ~215s. When the MCP client hangs up (an ESC in Claude Code) nothing
 * downstream learns about it, so the hold keeps issuing loopback calls — each a
 * fresh 60s function doing its own Supabase work — for the remaining budget.
 *
 * The fix is to let an EXTERNAL signal (the incoming `Request.signal`) reach the
 * fetch, so a disconnect aborts the in-flight poll and the next one never opens.
 *
 * WHY NOT `AbortSignal.any()`. It is the obvious tool and it lands in Node
 * 20.3; this package declares `engines.node >= 18.17` and is also bundled into
 * the desktop app, so the floor is real. The manual link below is the same
 * semantics with an explicit teardown — which we want regardless, because the
 * external signal outlives the request: a 215s hold attaches one listener per
 * poll to the SAME `Request.signal`, and without `detach()` those accumulate for
 * the life of the function.
 */
/** Undo a {@link linkAbort}. Always call it — see the file note on teardown. */
export type DetachAbortLink = () => void;
/** True when any of the supplied signals has already aborted. */
export declare function anyAborted(signals: ReadonlyArray<AbortSignal | undefined>): boolean;
/**
 * Abort `controller` as soon as any of `signals` aborts, forwarding the reason
 * so the eventual `DOMException` carries the caller's own cause.
 *
 * An already-aborted signal aborts the controller synchronously and returns a
 * no-op detach — there is nothing left to listen for.
 */
export declare function linkAbort(controller: AbortController, signals: ReadonlyArray<AbortSignal | undefined>): DetachAbortLink;
