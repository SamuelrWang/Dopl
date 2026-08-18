/**
 * THE DEADLINE CHAIN for `dopl_channel(op="await")` — every clock that can end
 * one hold, and the numbers chosen to sit under them. The op lives in
 * `channel-ops-await.ts`.
 *
 * The chain, innermost first:
 *   1. {@link AWAIT_POLL_MS} 50s — one inner long-poll asked of the route.
 *   2. `@dopl/client` AWAIT_TIMEOUT_MS 55s — the network read timeout on it.
 *   3. `/api/channels/[id]/await` `maxDuration = 60` — the route's own ceiling.
 *   4. the ASSEMBLED hold ({@link resolveAwaitHoldMs}) — polls 1-3 re-issued
 *      with the same cursor until messages land or the budget is spent.
 *   5. `/api/mcp` `maxDuration = 300` ({@link MCP_ROUTE_MAX_DURATION_MS}) — the
 *      function running the whole op, boot handshake included.
 *   6. THE CALLER'S OWN MCP CLIENT — see {@link AWAIT_HOLD_DEFAULT_MS}. Not
 *      reachable from here, and in practice the tightest one.
 *
 * ⚠ Each layer must answer before the layer above gives up, or the graceful
 * "nothing arrived, re-arm on the same since" RESULT is replaced by an abort —
 * and every re-arm instruction the agent needs lives in that result text, not
 * in an error.
 */
/**
 * Hard ceiling for ONE `await` op — the WAKE primitive. A Claude Code session
 * auto-backgrounds an MCP call still pending after ~2 min and delivers the
 * result as a task notification, which WAKES an idle session. Holding PAST the
 * two-minute mark is what turns "the peer replied" into "the requester's
 * session woke with the reply".
 *
 * ⚠ This is the ceiling for an EXPLICIT `timeout_ms`, a hold a caller can
 * actually get — so it must clear {@link MCP_ROUTE_MAX_DURATION_MS} by
 * {@link AWAIT_HOLD_MARGIN_MS}, same as the DEFAULT. A margin asserted only
 * against the default lets an explicit `timeout_ms` walk past the guard into
 * the platform's clock; the relation is pinned against BOTH numbers.
 *
 * ⚠ `channel.ts` reads this for the schema's `.max()` and the number the tool
 * description advertises — the three cannot drift.
 */
export declare const AWAIT_HOLD_CAP_MS = 230000;
/**
 * DEFAULT hold when the caller passes no `timeout_ms` — BELOW the cap so the
 * graceful result wins its race with the surrounding deadlines.
 * {@link AWAIT_HOLD_MARGIN_MS} under the route ceiling, pinned by a test, so a
 * platform clamp cannot turn every await into an opaque transport error
 * carrying none of the re-arm teaching.
 *
 * ⚠ THE TIGHTEST DEADLINE IS NOT IN THIS REPO — read before retuning. Claude
 * Code wraps every non-GET fetch to a `type: "http"` MCP server in an
 * AbortController firing `TimeoutError` after
 * `max(server.timeout ?? MCP_TOOL_TIMEOUT, 60_000)` ms, default 60_000, covering
 * TIME-TO-RESPONSE-HEADERS. `/api/mcp` must therefore keep STREAMING (SSE) and
 * must NOT set `enableJsonResponse: true` — that withholds headers until the
 * handler returns, so the 60s bound covers the whole call and every op (not
 * just `await`) dies at exactly 60.0s. Shortening this number does not fix it.
 *
 * Incident lever if a client-side cap reappears: `DOPL_AWAIT_HOLD_MS=55000`
 * fits every hold under a 60s abort, at the cost of the wake primitive.
 */
export declare const AWAIT_HOLD_DEFAULT_MS = 215000;
/**
 * `/api/mcp`'s function ceiling (`maxDuration = 300`, s → ms). ⚠ Mirrored so
 * the margin is a checkable relation; the suite pins it against the route source.
 */
export declare const MCP_ROUTE_MAX_DURATION_MS = 300000;
/**
 * ⚠ How far under {@link MCP_ROUTE_MAX_DURATION_MS} any reachable hold must sit
 * — default AND explicit-`timeout_ms` cap. The route authenticates, boots the
 * MCP server and runs a workspace handshake before the op starts, all under the
 * platform clock; a hold sized to the ceiling loses that race and the caller
 * gets a transport error instead of the graceful re-arm result.
 */
export declare const AWAIT_HOLD_MARGIN_MS = 60000;
/**
 * One INNER long-poll — `/api/channels/[id]/await` holds at most ~50s
 * (maxDuration 60). ⚠ Re-issued with the SAME `since` cursor: no cursor
 * advances until messages arrive, so a re-issue can neither skip nor
 * double-count.
 */
export declare const AWAIT_POLL_MS = 50000;
/**
 * The default hold, parsed from `DOPL_AWAIT_HOLD_MS` (integer milliseconds),
 * clamped to [{@link AWAIT_HOLD_FLOOR_MS}, {@link AWAIT_HOLD_CAP_MS}]. Anything
 * unparseable — unset, blank, non-numeric, float, negative — falls back to
 * {@link AWAIT_HOLD_DEFAULT_MS}.
 *
 * Env knob because this package ships as committed `dist/`: shortening the hold
 * during an incident would otherwise mean a rebuild + redeploy of the whole app.
 */
export declare function resolveAwaitHoldMs(raw: string | undefined): number;
/**
 * Ceiling for an EXPLICIT `timeout_ms` — normally {@link AWAIT_HOLD_CAP_MS}.
 * ⚠ When the env lever IS set it becomes the lever's value: the lever exists to
 * shorten holds during an incident, and a caller-supplied `timeout_ms` must not
 * route around it.
 */
export declare function resolveAwaitHoldCeilingMs(raw: string | undefined): number;
