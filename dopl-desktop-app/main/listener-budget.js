// listener-budget.js — THE CHANNEL LOOP'S POLL BUDGETS, AND WHAT AN ABORT MEANS.
//
// ⚠ SPLIT OUT OF listener-io.js ON 2026-08-30 (the 17 GB dev incident). Both that file and
// channel-listener.js were sitting at the ENGINEERING §2 500-line cap, and the fix below could
// not be written until something moved. The seam is the one listener-io.js's own CHEAP-AWAIT
// block already drew: these are PURE decisions over injected numbers, with no electron, no
// store, no fetch and no timer — so unlike its former home this module can simply be `require`d
// under `node --test` instead of being sliced out of a source file.
//
// WHAT LIVES HERE. How long one `/await` may hold (`awaitTimeoutFor`), how long we will wait for
// that answer (`fetchTimeoutFor`), the floors under both, and the ONE question the loop's catch
// block has to answer correctly: was this abort a WAKE, or was it us giving up?
//
// Pinned by test/listener-cheap-await.test.mjs.

// ⚠ THE NAMED FLOORS. Both selectors used to hand their argument straight through, and a budget
// that arrives as 0 / NaN / undefined is not a shorter hold but a DIFFERENT FAILURE — and
// neither of the two announces itself anywhere:
//   * an AWAIT budget of 0 fails the route's `AwaitQuerySchema` `.positive()` rule, so every
//     poll 400s and that channel lives on `backoff()` forever;
//   * a FETCH budget of 0 makes `listener-io.js › sendOnce` skip its AbortController timer
//     entirely (`timeoutMs ? setTimeout(…) : null`), so ONE hung request holds that channel's
//     loop for the life of the process. A loop that never returns never logs.
// Neither is reachable from `config.js` today; both are one edit away, which is the whole class
// of thing a floor is for.
//
// ⚠ THE AWAIT FLOOR IS 1, NOT A ROUND NUMBER, AND THAT IS DELIBERATE.
// `REALTIME.CHEAP_AWAIT_TIMEOUT_MS` is 1 BY DESIGN: the smallest value the route schema accepts,
// chosen so a healthy push transport gets a single-DB-read catch-up with no held serverless
// function, paired with the wake-interruptible `LONG_IDLE_MS`. **A `timeoutMs=1` in the server
// log is the cheap await WORKING, not a collapsed budget** — raising this floor would break the
// push transport rather than repair it. Read `config.js › REALTIME` before touching it.
const AWAIT_TIMEOUT_FLOOR_MS = 1;
const FETCH_TIMEOUT_FLOOR_MS = 1_000;

// Clamp a configured budget to its named floor. An unusable value becomes the floor rather than
// passing through, so there is no silent zero anywhere downstream.
function clampBudget(ms, floorMs) {
  const v = Number(ms);
  return Number.isFinite(v) && v >= floorMs ? v : floorMs;
}

// The `/await?timeoutMs=` value: cheap when push is healthy, else today's held timeout.
function awaitTimeoutFor(healthy, cheapMs, heldMs) {
  return clampBudget(healthy ? cheapMs : heldMs, AWAIT_TIMEOUT_FLOOR_MS);
}

// Our own fetch-abort budget: short when healthy, else today's held value.
function fetchTimeoutFor(healthy, cheapMs, heldMs) {
  return clampBudget(healthy ? cheapMs : heldMs, FETCH_TIMEOUT_FLOOR_MS);
}

/**
 * MAY THE LOOP RE-AWAIT IMMEDIATELY? True only for a WAKE.
 *
 * ⚠ AN ABORT IS TWO DIFFERENT EVENTS AND `channelLoop` TREATED THEM AS ONE (2026-08-30, the 17
 * GB dev incident). Its catch read `if (err.name === 'AbortError') continue;` under a comment
 * saying "our own fetch timeout (normal long-poll turnover) or a wake() kick — both just
 * re-await immediately". That was TRUE OF THE HELD POLL ONLY: there `AWAIT_FETCH_TIMEOUT_MS`
 * (58s) deliberately outlives the server's 50s hold, so the server always answers first with a
 * clean `timedOut: true` and an abort really was a wake.
 *
 * ⚠ IT IS NOT TRUE ON THE CHEAP PATH, WHICH IS THE NORMAL ONE WHENEVER PUSH IS HEALTHY. There
 * `CHEAP_FETCH_TIMEOUT_MS` (15s) sits UNDER a route whose own ceiling is 60s, so a server that
 * is merely SLOW — a dev `next dev` carrying every watched channel's catch-up, a cold lambda, a
 * saturated DB — blows our budget while it is still working. Re-polling at zero delay then sets
 * the loop's rate to the SERVER'S LATENCY instead of the 45s idle: each channel re-issues the
 * instant it gives up, each abandoned request leaves the server still executing it, and the
 * whole set converges on whatever rate keeps the server exactly slow enough to keep aborting.
 * Self-sustaining, and it never backs off. Measured: 22 watched channels went from one poll per
 * 45s each to one per 15s each, permanently.
 *
 * ⚠ THE DISCRIMINATOR IS OWNERSHIP, NOT THE ERROR — and it has to be, because both paths reject
 * with the same `AbortError`. `signal` here is `channelLoop`'s OWN per-iteration controller, and
 * the only things that abort it are `wakeEntry` (a realtime INSERT) and `wake()` (powerMonitor);
 * the fetch budget aborts `sendOnce`'s separate private controller, which this signal never
 * sees. So "did our signal fire" answers "was this a wake" exactly, on both transports.
 *
 * A non-abort rejection (a network error) is not a wake either — it takes the ladder.
 */
function isWakeAbort(err, signal) {
  if (!err || err.name !== 'AbortError') return false;
  return !!(signal && signal.aborted);
}

module.exports = {
  AWAIT_TIMEOUT_FLOOR_MS,
  FETCH_TIMEOUT_FLOOR_MS,
  clampBudget,
  awaitTimeoutFor,
  fetchTimeoutFor,
  isWakeAbort,
};
