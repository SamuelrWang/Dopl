// A VIRTUAL CLOCK OVER THE REAL ENGINE'S ONE TIMER (2026-10-11).
//
// ⚠ WHY IT EXISTS. `session-engine.js › scheduleIdle` is the only place in this tree that owns wall
// time, and until now nothing drove it: `session-work-cap.js`'s own comment says the engine's
// scheduleIdle "cannot be unit-tested", so the clamp was pinned only as ARITHMETIC in the pure module
// and as a REGEX over the engine's source. Both of those pass while the engine does the wrong thing —
// a regex over whole source is satisfied by a COMMENT, which is exactly the fail-open shape this review
// round is clearing out. The bounds in question are 5 minutes, 15 minutes, 2 hours and 4 hours, so
// driving them needs a clock, not patience.
//
// ⚠ IT INTERCEPTS NOTHING. `setTimeout` is still the real one and every timer the process arms is still
// armed for real (the engine harness already unrefs them). This only REMEMBERS `(ms, fn)` against the
// handle that was returned, so a case can look up the arming the engine made for a session —
// `s.idleTimer` IS that handle — and invoke its callback as the timer itself would. No guessing by
// duration, no module state keyed by session, and nothing else in the process behaves differently.
//
// ⚠ `Date.now` IS FROZEN, which is the half that matters for the two-hour cap: the engine reads it at
// every arming and `session-work-cap.js` takes it as an argument. Freeze it, advance it in whole hours,
// and the cap is reachable in a millisecond.
//
// Import ONCE per test file, at the top, before anything arms a timer.

const realSetTimeout = globalThis.setTimeout;
const realNow = Date.now;

/** handle -> the arming that produced it. */
const armings = new WeakMap();

globalThis.setTimeout = (fn, ms, ...rest) => {
  const h = realSetTimeout(fn, ms, ...rest);
  if (h && typeof h.unref === "function") h.unref();
  try { armings.set(h, { ms, fn }); } catch (_) { /* a primitive handle cannot be keyed; harmless */ }
  return h;
};

let frozen = null;
Date.now = () => (frozen === null ? realNow() : frozen);

/** Freeze the clock at `t`. */
export function freeze(t) {
  frozen = t;
  return t;
}

/** Move the frozen clock forward. */
export function advance(ms) {
  frozen = (frozen === null ? realNow() : frozen) + ms;
  return frozen;
}

/** The arming behind this session's current idle timer: `{ ms, fn }`, or undefined if it has none. */
export function armingOf(s) {
  return s && s.idleTimer ? armings.get(s.idleTimer) : undefined;
}

/** How long this session's timer was armed for, or null. */
export function armedMs(s) {
  const a = armingOf(s);
  return a ? a.ms : null;
}

/** Fire this session's timer exactly as the platform would, and answer whether there was one. */
export function expire(s) {
  const a = armingOf(s);
  if (!a) return false;
  a.fn();
  return true;
}
