// CORE EVENTS — the constructors an adapter's `normalize()` builds its answer out of.
//
// ⚠ THE VOCABULARY IS THE REDUCER'S, UNCHANGED. `main/session-reducer.js` already handles every
// name here and not one of them is Anthropic's; this file does not invent a layer, it names the
// one that was already there. An adapter may return a plain object of the same shape — these
// exist so the shapes are written down once and so a fixture test can build them without an SDK.
//
// ⚠ PURE. No electron, no fs, no session object, no dispatch. `normalize()` is fixture-testable
// precisely because everything below is a value, and that is what makes a Codex or Cursor adapter
// testable from a recorded transcript with nothing installed.

// ── RENDER EVENTS — dispatched straight through, shapes owned by the renderer ────────────────
const assistant = (text) => ({ type: 'assistant', payload: { type: 'turn', role: 'assistant', text } });
const thinking = (text) => ({ type: 'thinking', payload: { type: 'thinking', text } });
const toolUse = (payload) => ({ type: 'tool_use', payload });
const toolResult = (payload) => ({ type: 'tool_result', payload });
const outboundPost = (payload) => ({ type: 'outbound_post', payload });

// ── THE THREE CORE APPLIES BEFORE (OR INSTEAD OF) DISPATCHING ───────────────────────────────

/**
 * The runtime's own conversation handle plus the model it really picked.
 *
 * ⚠ `sdkSessionId` IS THE WHOLE RESUME STORY. `main/session-store.js` persists nothing else about
 * a running query, so a runtime with no resumable conversation handle degrades park / resume /
 * crash-resume to cold restarts. Core captures it and writes the durable record BEFORE the
 * reducer sees `launched` — the ordering `handleSdkMessage` has always had.
 */
/**
 * ⚠ `mcpServers` IS THE THIRD FIELD SINCE 2026-09-13 (F-692) AND IT IS CARRIED RAW. The init
 * message lists every MCP server the runtime connected — `{ name, status }[]` on this SDK
 * (`sdk.d.ts › SDKSystemMessage`) — and core read `session_id` and `model` off that message while
 * dropping the rest, so a session whose `dopl` server never connected ran its whole life with
 * every `mcp__dopl__*` call answering "No such tool available". `main/mcp-connect.js › doplStatus`
 * is the ONE reader of the shape; this event only carries it across the seam.
 * ⚠ `null` FOR A RUNTIME THAT REPORTS NO LIST, never `[]`: an empty array means "connected
 * nothing", and `mcpConnectVerdict` must be able to tell that apart from "told me nothing".
 */
const launched = (sessionId, model, mcpServers) => ({
  type: 'launched',
  sessionId,
  model: model || null,
  mcpServers: Array.isArray(mcpServers) ? mcpServers : null,
});

/**
 * A finished turn, reported as the platform's CUMULATIVE TOKEN TOTAL.
 *
 * ⚠ CUMULATIVE, NOT A DELTA, AND THAT IS THE SEAM. `main/session-io.js` owns the delta arithmetic
 * (`Math.max(0, total - s.lastTotalTokens)`) because it is the twin of `session-park.js ›
 * resumeParked`'s baseline reset — one assumption, stated in one place. An adapter that
 * pre-deltaed here would hide a platform whose totals do not restart on resume, which is the
 * failure `descriptor.session.usageResetsOnResume` exists to refuse.
 *
 * ── 🔒 ⚠ **THE COST FIELD IS DELETED (2026-09-22, Samuel: *"there shouldnt be cost? Claude
 * theres no cost tracking. we dont need cost tracking"*)** ────────────────────────────────────
 *
 * This took `(costUsd, sessionTokens, model)` and every adapter passed a first argument: one a
 * real `total_cost_usd`, one an explicit `null`, one a figure normalised off `agent.getUsage()`.
 * Core accumulated it into `state.costUsd`, persisted it in the durable record, carried a second
 * delta baseline for it across every resume, and shipped it to exactly NOTHING — no projection,
 * no wire field, no renderer, and not the credits system, which is separate and untouched.
 * ⚠ THE ARITY MOVED, WHICH IS WHY THIS IS A NOTE AND NOT A DIFF. A dropped leading argument is
 * silent — `result(tokens, model)` against the old signature would have read the token total as a
 * cost and the model as a token count — so the three call sites moved in the same change and
 * `test/runtime-contract.test.mjs` pins the shape this now produces.
 */
const result = (sessionTokens, model) => ({
  type: 'result',
  sessionTokens: typeof sessionTokens === 'number' && Number.isFinite(sessionTokens) ? sessionTokens : 0,
  model: model || null,
});

/**
 * HOW MUCH OF THE WINDOW THE LAST PROMPT OCCUPIED, observed per assistant message.
 *
 * ⚠ EMITTED PER MESSAGE, DISPATCHED PER TURN. `normalize` is pure and cannot remember the last
 * assistant message across calls, so it reports each one and core keeps the latest — which is
 * exactly what `session-model.js › observe` did with `s.promptTokens`, on the side of the seam
 * that is allowed to have state. A subagent's message must NOT produce one: a delegated run has
 * its own window, so counting its prompt as the session's makes the meter jump and snap back.
 * ⚠ `tokens` of 0 says nothing rather than painting a zero (`› contextEvent`).
 *
 * ── ⚠ `window` IS THE THIRD FIELD SINCE 2026-09-22, AND IT IS OPTIONAL BY DESIGN ──────────────
 *
 * THE DENOMINATOR THE PLATFORM ITSELF IS METERING AGAINST, when the platform says. Codex reports
 * `tokenUsage.modelContextWindow` on every `thread/tokenUsage/updated` (MEASURED against
 * `codex-cli 0.155.1`: 258400), and Dopl threw it away — so a Codex session showed an occupancy
 * with nothing to divide it by while a Claude session showed a percentage. The fix is NOT a Codex
 * row in `session-model.js`'s frozen table: a table is a claim this build re-earns every time a
 * vendor ships a model, and the server already answers.
 *
 * ⚠ **OPTIONAL MEANS THREE-VALUED, AND `null` IS NOT `0`.** A runtime that reports no window (both
 * the Claude and Cursor adapters call this with two arguments) produces `window: null`, which
 * `session-model.js › contextEvent` reads as "ask the table" and a reader renders as NO
 * percentage — raw tokens. A `0` would mean "this session has no window at all", i.e. a gauge that
 * paints "0 tokens available", which is the INVARIANTS rule this coercion exists to keep: UNKNOWN
 * STAYS DISTINCT FROM EMPTY. Anything that is not a finite positive number lands on `null`.
 */
const context = (tokens, model, window) => ({
  type: 'context',
  tokens: tokens > 0 ? tokens : 0,
  model: model || null,
  window: typeof window === 'number' && Number.isFinite(window) && window > 0 ? window : null,
});

/**
 * THIS MACHINE HAS NO USABLE CREDENTIAL FOR THIS RUNTIME, recognised in the stream itself.
 *
 * ⚠ IT SHORT-CIRCUITS THE CONSUME LOOP, which is why it is a CoreEvent and not a render event:
 * core stops reading, parks the session and swaps the dead-end bubble for the sign-in action. The
 * `text` is the platform's own sentence, carried for the log and never rendered as a claim.
 */
const authHold = (text) => ({ type: 'auth_hold', text: String(text == null ? '' : text) });

module.exports = {
  assistant, thinking, toolUse, toolResult, outboundPost,
  launched, result, context, authHold,
};
