/**
 * THE DEADLINE CHAIN for `dopl_channel(op="await")` — every clock that can end
 * one hold, and the numbers chosen to sit under them. Split out of
 * `channel-ops-read.ts` at the §2 500-line cap; the op itself lives there.
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
 * Each layer must be able to answer before the layer above gives up, or the
 * graceful "nothing arrived, re-arm on the same since" RESULT is replaced by an
 * abort — and every re-arm instruction the agent needs lives in that result
 * text, not in an error.
 */

/**
 * Hard ceiling for ONE `await` op — the WAKE primitive (WAKE-V1).
 *
 * A Claude Code session auto-backgrounds any MCP tool call still pending after
 * ~2 minutes and delivers the eventual result as a task notification, and a
 * task notification WAKES an idle session. So an await that holds PAST that
 * two-minute mark is what turns "the peer replied" into "the requester's own
 * session woke up with the reply" — no human re-prompt.
 *
 * FIX M3 — 230s, WAS 240s. This is the ceiling for an EXPLICIT `timeout_ms`, so
 * it is a hold a caller can actually get, not a theoretical bound: it has to
 * clear {@link MCP_ROUTE_MAX_DURATION_MS} by {@link AWAIT_HOLD_MARGIN_MS} for
 * exactly the reason the DEFAULT does. At 240s it did not — 240 + 60 = 300, no
 * margin at all — and the margin was asserted only against the default, so
 * `timeout_ms=240000` walked straight past the guard into the platform's own
 * clock. The relation is now pinned against BOTH numbers.
 *
 * `channel.ts` reads this for the schema's `.max()` and for the number it
 * advertises in the tool description, so the three can never drift.
 */
export const AWAIT_HOLD_CAP_MS = 230_000;

/**
 * DEFAULT hold when the caller passes no `timeout_ms` — deliberately BELOW the
 * cap so the graceful result wins its race with the surrounding deadlines (Q9).
 * {@link AWAIT_HOLD_MARGIN_MS} under the route ceiling, pinned by a test, so a
 * platform clamp cannot cut the hold and turn every await into an opaque
 * transport error carrying none of the re-arm teaching.
 *
 * THE TIGHTEST DEADLINE IS NOT IN THIS REPO — READ THIS BEFORE RETUNING (Q9,
 * 2026-07-31). Claude Code wraps every non-GET fetch to a `type: "http"` MCP
 * server in an AbortController that fires
 * `DOMException("The operation timed out.", "TimeoutError")` after
 * `max(server.timeout ?? MCP_TOOL_TIMEOUT, 60_000)` ms — DEFAULT 60_000. That
 * timer covers TIME-TO-RESPONSE-HEADERS, and `/api/mcp` USED TO run the
 * transport with `enableJsonResponse: true`, which withholds the whole response
 * (headers included) until the tool handler returns — so the 60s bound covered
 * the WHOLE call. Every observed incident ended at exactly 60.0s: `op="await"`,
 * but also `op="list"` and a `dopl_kb` read, so it was never an await-specific
 * fault, and shortening the hold from 240s to 215s did not fix it.
 *
 * RESOLVED BY THE TRANSPORT, NOT BY THIS NUMBER (FIX M1). `/api/mcp` dropped
 * `enableJsonResponse` and now streams (SSE), so headers flush at t≈0 and the
 * 60s client bound covers only the handshake. That fixes every client we cannot
 * configure — terminal Claude Code, claude.ai connectors, Claude Desktop,
 * third-party clients — with no per-server `timeout` needed. The desktop still
 * writes `timeout` on its own entries (`main/mcp-config.js`, `main/sdk-loader.js`,
 * and the CLI's user-scope config via `main/mcp-cli-entry.js`) as belt-and-braces.
 * The lever that works from here if a client-side cap ever reappears:
 * `DOPL_AWAIT_HOLD_MS=55000` fits every hold under a 60s abort, at the cost of
 * the wake primitive.
 */
export const AWAIT_HOLD_DEFAULT_MS = 215_000;

/**
 * Floor for the env override. Below ~50s a hold is shorter than ONE inner poll
 * and can never cross the two-minute backgrounding mark, so the op stops being
 * a wake primitive at all — an incident lever must be able to shorten the hold,
 * not to silently disable the feature.
 */
const AWAIT_HOLD_FLOOR_MS = 50_000;

/**
 * The `/api/mcp` route's function ceiling (`maxDuration = 300`, seconds → ms).
 * Mirrored here so the margin below is a checkable relation instead of a
 * comment; the test suite pins it against the route's own source.
 */
export const MCP_ROUTE_MAX_DURATION_MS = 300_000;

/**
 * How far under {@link MCP_ROUTE_MAX_DURATION_MS} any reachable hold must sit —
 * the default AND the cap an explicit `timeout_ms` can ask for (FIX M3).
 * The route authenticates, boots the MCP server and runs a workspace handshake
 * before the op starts, and the platform's own clock covers all of it — a hold
 * sized right up to the ceiling loses that race, and the caller gets a
 * transport error instead of the graceful re-arm result.
 */
export const AWAIT_HOLD_MARGIN_MS = 60_000;

/**
 * One INNER long-poll. The `/api/channels/[id]/await` route holds at most ~50s
 * (its own maxDuration is 60), so the assembled hold is built out of a handful
 * of these, re-issued with the SAME `since` cursor — no cursor advances until
 * messages actually arrive, so a re-issue can neither skip nor double-count.
 */
export const AWAIT_POLL_MS = 50_000;

/**
 * The default hold, parsed from `DOPL_AWAIT_HOLD_MS` (integer milliseconds),
 * clamped to [{@link AWAIT_HOLD_FLOOR_MS}, {@link AWAIT_HOLD_CAP_MS}]. Anything
 * unparseable — unset, blank, non-numeric, a float, a negative — falls back to
 * {@link AWAIT_HOLD_DEFAULT_MS}.
 *
 * WHY AN ENV KNOB: this package ships as committed `dist/`, so shortening the
 * hold during an incident (a platform timeout regression, a client-side call
 * deadline, a function-duration bill spike) would otherwise mean a rebuild +
 * redeploy of the whole app. One env flip is the smaller lever.
 */
export function resolveAwaitHoldMs(raw: string | undefined): number {
  const text = (raw ?? "").trim();
  if (!/^\d+$/.test(text)) return AWAIT_HOLD_DEFAULT_MS;
  const ms = Number.parseInt(text, 10);
  if (!Number.isFinite(ms)) return AWAIT_HOLD_DEFAULT_MS;
  return Math.min(AWAIT_HOLD_CAP_MS, Math.max(AWAIT_HOLD_FLOOR_MS, ms));
}

/**
 * Ceiling for an EXPLICIT `timeout_ms`. Normally {@link AWAIT_HOLD_CAP_MS}, so a
 * caller who deliberately asks for the full 230s still gets it. When the env
 * lever IS set it becomes the lever's value instead: the lever exists to shorten
 * holds during an incident, and a caller-supplied `timeout_ms=230000` must not
 * route around it.
 */
export function resolveAwaitHoldCeilingMs(raw: string | undefined): number {
  return /^\d+$/.test((raw ?? "").trim())
    ? resolveAwaitHoldMs(raw)
    : AWAIT_HOLD_CAP_MS;
}
