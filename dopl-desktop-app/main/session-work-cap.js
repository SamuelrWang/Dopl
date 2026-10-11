// THE CONTINUOUS-WORK CAP — the clock that lets tool activity hold the idle TTL open without holding it
// open FOREVER (2026-10-10, Samuel: *"never park mid-work"*).
//
// ⚠ WHY THERE IS A CLOCK HERE AT ALL, AND WHY IT IS NOT IN THE REDUCER. `session-reducer.js` is pure and
// holds no clock by construction; its timer decision (`session-state.js › idleTimeout`) answers "how long
// from NOW", never "how long has this been going". A cap is the second kind of question, so it lives beside
// the engine's `setTimeout` — the one place that already owns wall time — and the reducer only ever says
// WHICH KIND of re-arm it is asking for (`{ type: 'scheduleIdle', from: 'work' }`).
//
// ── WHAT IT MEASURES: ONE STRETCH OF WORK, NOT A SESSION ──────────────────────────────────────────────
//
// `s.workSince` is stamped by the FIRST live frame of a stretch and cleared at every boundary that means
// the stretch is over — a turn end (`result`) and every query teardown (`abortQuery`, which park, crash and
// end all run). So the span is "continuously working, with no turn end in between", which is the thing a
// runaway loop does and a long task does not.
//
// ⚠ IT IS NOT STAMPED AT THE TURN END, DELIBERATELY. Measuring from the last `result` would charge the
// stretch for the up-to-15-minute idle gap that precedes it, so an agent that sat between turns and then
// started a long task would be capped early for having waited. The stretch starts when work starts.
//
// ⚠ AND THE STALE-STAMP TRAP IS WHY THE CLEARS ARE NOT OPTIONAL. A `workSince` left behind by a stretch
// that parked two hours ago would make the FIRST tool frame of the next one read as already past the cap
// and park the session instantly, on a loop. Every clear site is named above; `capMsLeft` answers the full
// cap for an unstamped session so a missed clear fails toward LETTING IT WORK, never toward parking it.
//
// PURE: no require, no `Date.now()` — `now` is handed in, like `session-health.js › isStale`.

// ─── BEGIN SESSION-WORK-CAP (pure; unit-tested via source extraction) ────────

/**
 * HOW LONG ONE UNBROKEN STRETCH OF WORK MAY HOLD THE IDLE TTL OPEN. Two hours (Samuel, 2026-10-10).
 *
 * ⚠ IT IS A BACKSTOP, NOT A BUDGET, and the two numbers answer different questions. `DEFAULT_IDLE_MS` (15
 * minutes) is "nothing is happening, park it" — a statement about SILENCE. This is "something is happening
 * and has not stopped happening for two hours" — a statement about a LOOP. Before this existed the first
 * number did both jobs, and it did the second one by accident: only a turn END re-armed the timer, so an
 * agent fifteen minutes into one long task looked exactly like an agent that had gone quiet, and was parked
 * mid-tool-call with its query torn down.
 *
 * ⚠ WHAT IT COSTS WHEN IT FIRES IS A PARK, NOT AN END — the ordinary `idle_timeout`, resumable, posture and
 * grants intact (M2). A cap that ended the session would make a slow task unrecoverable.
 */
const WORK_CAP_MS = 2 * 60 * 60 * 1000;

/** A finite, non-negative stamp, or null. ⚠ `typeof` first, never `Number()`: `Number(null)` is 0, which
 *  here would read as "this stretch began at the epoch" — maximally past the cap. */
function stampOf(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value;
}

/** THE STRETCH IS OVER: a turn ended, or the query was torn down. Idempotent. */
function noteBoundary(s) {
  if (s) s.workSince = null;
}

/** A LIVE FRAME: start the stretch if it has not started, and never move a start that already exists.
 *  Returns the stretch's start. */
function noteWork(s, now) {
  if (!s) return null;
  const at = stampOf(s.workSince);
  if (at !== null) return at;
  const fresh = stampOf(now);
  s.workSince = fresh;
  return fresh;
}

/**
 * HOW MUCH OF THE CAP IS LEFT, clamped at zero.
 *
 * ⚠ AN UNSTAMPED SESSION HAS THE WHOLE CAP, which is the fail-toward-working direction: a stretch nothing
 * has measured is not evidence of a runaway, and this value only ever SHORTENS an idle timer.
 */
function capMsLeft(s, now) {
  const at = stampOf(s && s.workSince);
  const t = stampOf(now);
  if (at === null || t === null) return WORK_CAP_MS;
  return Math.max(0, WORK_CAP_MS - (t - at));
}

/**
 * THE WHOLE DECISION A WORK RE-ARM MAKES: stamp the stretch if it is new, then return how long the idle
 * timer may be armed for — the ordinary TTL, or what is left of the cap when that is less.
 *
 * ⚠ IT IS HERE RATHER THAN AT THE `setTimeout` SO IT CAN BE PINNED: the arithmetic is covered by
 * `session-work-cap.test.mjs`, and the engine's use of it end to end by `session-work-cap-engine.test.mjs`.
 * ⚠ IT ONLY EVER SHORTENS: `Math.min` against the TTL the reducer's own table chose, never a replacement
 * for it. A zero means the cap is spent and the caller's ordinary park fires on the next tick.
 */
function workIdleMs(s, baseMs, now) {
  const base = stampOf(baseMs);
  if (base === null) return 0;
  noteWork(s, now);
  return Math.min(base, capMsLeft(s, now));
}

// ─── END SESSION-WORK-CAP ────────────────────────────────────────────────────

module.exports = {
  WORK_CAP_MS,
  stampOf,
  noteBoundary,
  noteWork,
  capMsLeft,
  workIdleMs,
};
