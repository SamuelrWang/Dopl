// ONE bound for a promise that may never settle. The main process's "this await has no
// deadline" primitive, in one place.
//
// WHAT IT IS FOR (2026-09-15 boot, F-700). F-698 bounded the Supabase refresh POST
// (`auth-refresh-transport.js`) and watchdogged the two single-flight guards
// (`listener-heal.js › watchPass`, `session-state-push.js › drain`), and the 08:22:33Z boot
// still wedged in the SAME shape: Electron's stdout carried
// `Network service crashed or was terminated, restarting service.` at that second,
// `presence: started` at 08:22:33.624, and then `presence: superseding the in-flight beat` at
// 08:23:05 — the FIRST beat was still in flight after THIRTY SECONDS. No `reconcile:`, no
// `namecache loaded`, no `session-state push`, no `auth-tokens` line followed (a healthy boot
// — 2026-09-14 01:05 / 01:19 / 01:22 — aborts the superseded beat within ~12s and loads the
// name cache within ~15s). A fresh process has a fresh undici pool and the refresh POST is
// bounded, so the hang was upstream of both: `session.defaultSession.cookies.get()`, which
// EVERY request path awaits BEFORE its own AbortController timer starts. Chromium's network
// service owns the cookie store; when it dies and restarts at boot, an in-flight `cookies.get`
// promise can simply be dropped and never settle, and nothing downstream is ever reached.
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
