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
 *   6. THE CALLER'S OWN MCP CLIENT ({@link EXTERNAL_CLIENT_ABORT_MS}) — not
 *      reachable from here, and for every external caller the tightest one BY
 *      FAR: ~60s against layer 4's 215s.
 *
 * ⚠ Each layer must answer before the layer above gives up, or the graceful
 * "nothing arrived, re-arm on the same since" RESULT is replaced by an abort —
 * and every re-arm instruction the agent needs lives in that result text, not
 * in an error.
 *
 * ⚠ **WHICH IS WHY LAYER 4 IS NOT ONE NUMBER (T03).** A default sized for the
 * wake primitive (layer 5's clock) is ~3.5× a default that survives layer 6, so
 * a single default has to fail one of them — and it failed layer 6, silently:
 * an external `await` at the default returned a RAW TRANSPORT TIMEOUT carrying
 * none of the teaching, which is the one outcome this whole chain exists to
 * prevent. {@link awaitHoldMs} picks per caller from the one thing the server
 * can observe about which side of layer 6 it is on — the runtime stamp.
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
 * DEFAULT hold for a DESKTOP-RUN session — BELOW the cap so the graceful result
 * wins its race with the surrounding deadlines. {@link AWAIT_HOLD_MARGIN_MS}
 * under the route ceiling, pinned by a test, so a platform clamp cannot turn
 * every await into an opaque transport error carrying none of the re-arm
 * teaching.
 *
 * ⚠ **IT IS NOT THE DEFAULT FOR AN EXTERNAL CALLER — see
 * {@link AWAIT_HOLD_EXTERNAL_DEFAULT_MS}.** It was, and it made `await`
 * unusable from every external MCP client: 215s against a ~60s client abort is
 * not a long hold, it is a guaranteed transport error.
 *
 * The length is the WAKE PRIMITIVE and is worth keeping where it can be had:
 * a desktop-run session is fed replies as new turns, and this hold is what
 * keeps a pending call alive past the ~2-minute backgrounding mark for the
 * clients that do background.
 *
 * Incident lever: `DOPL_AWAIT_HOLD_MS=55000` shortens BOTH defaults (it is a
 * ceiling, {@link resolveAwaitHoldCeilingMs}) at the cost of the wake.
 */
export declare const AWAIT_HOLD_DEFAULT_MS = 215000;
/**
 * THE CALLER'S OWN MCP CLIENT, MEASURED — Claude Code wraps every non-GET fetch
 * to a `type: "http"` MCP server in an AbortController firing `TimeoutError`
 * after `max(server.timeout ?? MCP_TOOL_TIMEOUT, 60_000)` ms, default 60_000.
 *
 * ⚠ A HAND-MEASURED PROPERTY OF SOMEONE ELSE'S CLIENT, so it is a FLOOR to
 * design under, never a promise: another client may be tighter, and a caller
 * that knows its own is looser passes an explicit `timeout_ms`, which
 * {@link awaitHoldMs} honours up to {@link AWAIT_HOLD_CAP_MS}.
 *
 * ⚠ It covers TIME-TO-RESPONSE-HEADERS, which is why `/api/mcp` must keep
 * STREAMING (SSE) and must NOT set `enableJsonResponse: true` — that withholds
 * headers until the handler returns, so the bound would cover the whole call and
 * EVERY op (not just `await`) would die at exactly 60.0s. Shortening the hold
 * does not fix that; only streaming does.
 */
export declare const EXTERNAL_CLIENT_ABORT_MS = 60000;
/**
 * ⚠ How far under {@link EXTERNAL_CLIENT_ABORT_MS} an unstamped caller's hold
 * must sit. Same class of cost as {@link AWAIT_HOLD_MARGIN_MS} and the same
 * reason — `/api/mcp` authenticates, boots the MCP server and runs a workspace
 * handshake before the op starts, all inside the client's clock — scaled to the
 * smaller budget: a hold sized AT the abort loses that race and hands back the
 * transport error instead of the result.
 */
export declare const AWAIT_HOLD_EXTERNAL_MARGIN_MS = 15000;
/**
 * DEFAULT hold when the request carried NO desktop runtime stamp (T03).
 *
 * ⚠ **THIS TRADES THE WAKE PRIMITIVE AWAY, AND THAT IS THE POINT** — under a
 * ~60s client abort the wake was never available, so what the long default
 * actually bought an external caller was a raw `TimeoutError` with no cursor,
 * no session block and no re-arm instruction. A returned result the caller can
 * poll on beats a wake it cannot have.
 *
 * ⚠ An unstamped caller may still BE a desktop session (an older build), which
 * loses nothing but hold length — it is told what its cursor is either way.
 */
export declare const AWAIT_HOLD_EXTERNAL_DEFAULT_MS: number;
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
/** Don't re-issue an inner poll for a sliver of the remaining budget. */
export declare const AWAIT_MIN_POLL_MS = 1000;
/**
 * ⚠ Spin brake, NOT the bound — elapsed wall-clock ends the hold. Bites only
 * when the server answers instantly (route error path, clamped timeout), where
 * the elapsed check alone lets the loop hammer it. Tripping returns the
 * ordinary timed-out result.
 */
export declare const AWAIT_MAX_POLLS: number;
/**
 * A hold ending this far under the ASK did not hold — something cut it short
 * (platform function clamp, route answering instantly, inner failure). ⚠
 * Re-arming into that is a spin: each attempt returns in seconds, so the call
 * never stays pending past the ~2 min backgrounding mark and never becomes a
 * wake. Half the ask, capped at 60s, so a deliberately SHORT hold is not warned
 * about getting one.
 */
export declare const AWAIT_SHORT_HOLD_MS = 60000;
/**
 * THE HOLD THIS CALL GETS. ⚠ Two rules, and the order between them is the whole
 * fix (T03):
 *
 *   1. **AN EXPLICIT `timeout_ms` IS HONOURED EXACTLY**, clamped only by the
 *      ceiling that keeps the hold under `/api/mcp`'s function clock (and by the
 *      incident lever, which a caller must not route around). A caller that
 *      knows its own client — a longer-lived one, or a background poller — asks
 *      and gets what it asked for. It is NOT re-shortened to the external
 *      default: that would make the parameter a suggestion.
 *   2. **THE DEFAULT DEPENDS ON WHO IS ASKING.** A desktop-stamped request gets
 *      the wake-length hold; anything else gets one that fits under
 *      {@link EXTERNAL_CLIENT_ABORT_MS}, because for that caller the long hold
 *      does not produce a long wait — it produces no result at all.
 *
 * ⚠ `runtime` is an OBSERVATION and gates nothing (`identity.ts`,
 * `shared/auth/runtime-header.ts`). Reading it wrong costs hold length in one
 * direction and a transport error in the other; it grants nothing either way.
 *
 * ⚠ `Math.min` against `ENV_HOLD_MS` on the external arm, not a bare constant:
 * the incident lever must be able to shorten EVERY default, including this one.
 */
export declare function awaitHoldMs(timeoutMs: number | undefined, runtime: string | null): number;
