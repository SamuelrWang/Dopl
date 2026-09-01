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
const launched = (sessionId, model) => ({ type: 'launched', sessionId, model: model || null });

/**
 * A finished turn, reported as the platform's CUMULATIVE totals.
 *
 * ⚠ CUMULATIVE, NOT A DELTA, AND THAT IS THE SEAM. `main/session-io.js` owns the delta arithmetic
 * (`Math.max(0, total - s.lastTotalCost)`) because it is the twin of `session-park.js ›
 * resumeParked`'s baseline reset — one assumption, stated in one place. An adapter that
 * pre-deltaed here would hide a platform whose totals do not restart on resume, which is the
 * failure `descriptor.session.usageResetsOnResume` exists to refuse.
 * ⚠ `costUsd: null` MEANS THE PLATFORM EMITS NO COST, and must never become `0`: a zero is a
 * budget that never trips.
 */
const result = (costUsd, sessionTokens, model) => ({
  type: 'result',
  costUsd: typeof costUsd === 'number' && Number.isFinite(costUsd) ? costUsd : null,
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
 */
const context = (tokens, model) => ({ type: 'context', tokens: tokens > 0 ? tokens : 0, model: model || null });

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
