// SESSION METRICS — the agent view's NUMBERS, split out of session-summary.js (2026-08-20).
//
// ⚠ WHY IT IS ITS OWN FILE, and the reason is the seam rather than the line count. §1's rule
// is ONE FILE, ONE REASON TO CHANGE: `session-summary.js` answers "what STATE is this session
// in" — a projection whose whole job is one derivation every consumer is handed — and this
// answers "what has it COST", which moves when the model table moves, when a new counter is
// added, or when the SDK changes where usage lives. Two reasons, and the projection file has
// now been pushed over the 500-line cap three times by additions that were not about state at
// all (F-226 named this file's seams; this is the cheaper of the two it listed).
//
// ⚠ NOTHING HERE STARTS A COUNTER. Every value is read from where it already lives on the
// session object; this module only decides how to say "not measured".
//
// PURE below the sentinel, injected as free vars — the same shape `session-detail.js` uses and
// the same reason: `session-summary.js` requires it ABOVE its own sentinel and its harness
// injects the real thing, so one program is under test rather than a slice plus a stub.

const { contextWindowFor } = require('./session-model');

// ─── BEGIN SESSION-METRICS-PURE (injectable; unit-tested via source extraction) ──────
// `contextWindowFor` is a free var from here down.

/**
 * A NUMBER OR NOTHING. `null` is the honest answer for "this build cannot say" and for "nothing
 * has been measured yet" alike, and the renderer draws neither as a zero — a context meter at
 * 0/0 and a meter with no denominator are different claims, and only one of them is true before
 * the first turn reports usage. ⚠ Never coerce a missing metric to 0 here: an amber meter that
 * says the window is empty is a lie the operator acts on.
 */
function metricOrNull(value) {
  // ⚠ `typeof` FIRST, never a bare Number(): `Number(null)` is 0 and `Number('')`
  // is 0, so a coercion-only guard turns every one of the absences above into a
  // confident zero — which is the exact lie this function exists to prevent.
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value;
}

/**
 * THE AGENT-VIEW NUMBERS, from wherever they already are on the live session object. Split out
 * so `liveSummary` reads as identity + state and this reads as measurement.
 *
 * ⚠ EVERY ONE OF THESE ALREADY EXISTED — nothing here starts a counter:
 *   contextUsed    `s.promptTokens`, written by session-model's observer from the LAST assistant
 *                  message's own usage (occupancy, output excluded — see that file's header).
 *   contextWindow  `contextWindowFor(s.liveModel)`, the frozen model->window table. `null` for a
 *                  model this build has never heard of, which is what makes the meter show raw
 *                  tokens instead of a made-up percentage.
 *   tokensSpent    `s.tokensSpent`, the lifetime accumulation session-io.js keeps beside the
 *                  identical cost arithmetic. A DIFFERENT question from occupancy.
 *   startedAt      `s.startedAt`, stamped when the engine created this session object.
 *   lastActivityAt `s.lastActivityAt`, stamped at the engine's one dispatch funnel.
 * ⚠ THEY REACH THE SERVER NOW, AND THIS BULLET SAID THE OPPOSITE UNTIL 2026-08-22 (F-270). It
 * read "NONE of them reaches the server: `session-state-push.js › rowFor` picks its columns by
 * name, so a widened wire shape does not widen `channel_sessions`" — and it was wrong TWICE
 * over. The symbol was never `rowFor`; the real one is `session-state-push.js › reportRow`, and
 * the stale anchor had been copied into four files. And the CLAIM is now false: the orchestrator
 * wave added these five plus `detail` / `toolLabel` / `model` to that by-name pick, with
 * nullable columns on the far side to receive them.
 * ⚠ WHAT IS STILL TRUE, AND IS THE PART WORTH KEEPING: the pick is BY NAME, so a metric added
 * HERE does not reach `channel_sessions` until somebody names it there — deliberately.
 * ⚠ AND THEY ARE QUANTIZED ON THE WAY OUT (`session-telemetry.js`): the values a peer reads are
 * bucketed, because `lastActivityAt` moves on every dispatch and an unquantized wire would turn
 * the state-change writer into a per-event one.
 */
function metrics(s) {
  return {
    contextUsed: metricOrNull(s && s.promptTokens),
    contextWindow: metricOrNull(contextWindowFor(s && s.liveModel)),
    tokensSpent: metricOrNull(s && s.tokensSpent),
    startedAt: metricOrNull(s && s.startedAt),
    lastActivityAt: metricOrNull(s && s.lastActivityAt),
  };
}
// ─── END SESSION-METRICS-PURE ────────────────────────────────────────────────────────

module.exports = { metricOrNull, metrics };
