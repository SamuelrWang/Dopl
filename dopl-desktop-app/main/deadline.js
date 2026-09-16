// ONE bound for a promise that may never settle. The main process's "this await has no
// deadline" primitive, in one place (F-700, 2026-09-15; the boot it was written for is in
// `auth-cookies.js › jarCall`'s header).
//
// ⚠ DEPENDENCY-FREE ON PURPOSE (no electron, no store, no diag) — same argument as
// `listener-heal.js`: `test/deadline.test.mjs` drives the REAL shipped function under
// `node --test` rather than a source-sliced copy. The logger is the caller's `onDeadline`.
//
// ⚠ NOT A FORK OF `watchPass`. `listener-heal.js › watchPass` watches a pass it does not own
// and always resolves (its caller only wants to be TOLD the pass overran); this one is a value
// bound — it hands the winner back, so a caller can tell "the store answered `[]`" from "the
// store never answered" via the DEADLINE sentinel.

// The sentinel a timed-out call resolves with. A Symbol so it can never collide with a real
// answer (`null`, `''`, `[]`, `undefined` are all legitimate cookie-store results).
const DEADLINE = Symbol('deadline');

/**
 * Race `promise` against `ms`. Resolves the promise's own value when it settles first, or the
 * DEADLINE sentinel when the clock wins. REJECTIONS PASS THROUGH untouched — this bounds
 * silence, it does not swallow errors; every caller here already has its own catch.
 *
 * @param {Promise<*>} promise the call that may never settle
 * @param {number} ms the deadline
 * @param {Function} [onDeadline] called ONCE, with `ms`, when the clock wins (diag goes here)
 * @param {{setTimeout:Function, clearTimeout:Function}} [timers] test seam; defaults to globals
 */
function withDeadline(promise, ms, onDeadline, timers) {
  const set = (timers && timers.setTimeout) || setTimeout;
  const clear = (timers && timers.clearTimeout) || clearTimeout;
  let timer = null;
  const deadline = new Promise((resolve) => {
    timer = set(() => {
      // ⚠ SWALLOW, not `finally` — and this is the ONE place this differs from `watchPass`.
      // A `finally` resolves the race but still lets the throw out of a TIMER callback, where
      // there is no caller to catch it: in the main process that is an uncaughtException, i.e.
      // a bound against a wedge that can crash the app instead. A broken logger must cost
      // nothing but its own line.
      try {
        if (typeof onDeadline === 'function') onDeadline(ms);
      } catch (_) { /* never let logging break the bound */ }
      resolve(DEADLINE);
    }, ms);
    // ⚠ `unref` so a pending deadline never holds the process open on the quit path.
    if (timer && typeof timer.unref === 'function') timer.unref();
  });
  // ⚠ CLEAR ON EITHER OUTCOME. Without this a 5s timer is left armed by every fast call, and
  // the cookie store is read on every beat, every reconcile and every post.
  return Promise.race([Promise.resolve(promise), deadline]).then(
    (v) => { clear(timer); return v; },
    (err) => { clear(timer); throw err; }
  );
}

module.exports = { DEADLINE, withDeadline };
