// THE CHAINED-LAUNCH BUDGET — the backstop that makes agent chaining ON ≠ a fork bomb
// (2026-08-31, Samuel's ruling: "with the toggle ON, is there ANY depth bound left? Add an honest
// backstop").
//
// ── WHY A BUDGET AND NOT A GENERATION CAP ────────────────────────────────────────────────────
//
// `session-own-launch.js` explains at length why "N generations" is not a bound this build can
// express: the ask leaves the machine as a `channel_launch_directives` row, that row has no depth
// column, and arithmetic over a number that cannot cross the wire is a bound in name only. So
// with the channel's chaining setting ON the DEPTH bound is gone, and something else has to hold.
//
// ⚠ `MAX_CONCURRENT_SESSIONS` IS ALREADY THERE AND IS NOT ENOUGH, WHICH IS THE WHOLE ARGUMENT FOR
// THIS FILE. `session-launch.js › launch` refuses a SIXTEENTH live session with `cap`, so the
// INSTANTANEOUS fan-out is bounded at fifteen no matter what. But sessions SETTLE and free their
// slots — so an unbounded chain under a fixed concurrency ceiling is not stopped, it is merely
// RATE-LIMITED to fifteen at a time, forever, which is a fork bomb that has learned patience. The
// missing bound is over TIME, and that is exactly what this is.
//
// ── WHAT IT COUNTS, AND WHAT IT DELIBERATELY DOES NOT ────────────────────────────────────────
//
// ONE COUNTER PER CHANNEL, spent ONLY by a spawn carrying the chaining flag. The operator's own
// New Agent button, a peer-triggered responder, a resume and a recreate all pass no flag and
// therefore spend nothing — this must never become a bound on the operator's own hands. It is a
// bound on the one lane that can grow without one.
//
// ⚠ PER CHANNEL, matching the SETTING's scope. A machine-wide budget would let one busy room
// starve every other; a per-session one would bound the branching factor and not the tree.
//
// ⚠ IN MEMORY, AND THE RESTART CASE IS AN ARGUMENT RATHER THAN AN OVERSIGHT. A quit takes every
// live session with it (`quit-guard.js`), so a relaunch starts with no chain running and nothing
// to keep counting — the state this module holds is exactly as durable as the thing it bounds.
// A durable ledger would additionally have to be a durable ledger an agent with `Bash` could
// rewrite, which buys nothing.
//
// ⚠ THE REFUSAL IS `cap`, NOT A NEW WORD. `launch-directive-wire.js › REFUSAL_REASONS` is a
// SEVEN-word closed vocabulary an orchestrator has been taught to read, and `cap`'s own sentence
// already says "the machine is FULL" and sends the agent to `read_sessions` rather than to a
// retry — which is the true and useful thing to say here. An eighth word would be a wire change
// bought for a shade of meaning.
//
// PURE — no electron, no store, no require. `test/launch-budget.test.mjs` drives it with an
// injected clock.

// ⚠ THE TWO NUMBERS, AND WHERE THEY COME FROM RATHER THAN BEING CHOSEN FOR ROOM.
// `session-windowless.js › MAX_CONCURRENT_SESSIONS` is 15 (raised 6 → 15 on 2026-09-01), so THIRTY
// is two complete turnovers of the machine's ENTIRE capacity inside the window — far above any
// real staffing pattern (an orchestrator hiring fifteen workers spends half of it) and far below a
// chain that is running away, which reaches it in seconds. The window is long enough that a burst
// cannot be re-spent by simply waiting a moment, and short enough that a legitimate operator who
// hits it is not locked out for the afternoon.
// ⚠ IT WAS RAISED WITH THE CONCURRENCY CEILING, ON 2026-09-01, AND HAD TO BE. At 12, an
// orchestrator staffing a single channel to the NEW cap was refused at its thirteenth worker
// inside the window — i.e. the rate bound would have silently capped the machine at 12 and made
// the concurrency raise unreachable on the one lane it was raised FOR. A rate ceiling below the
// cost ceiling is not a backstop, it is the real cap wearing the wrong name.
// ⚠ THEY ARE STILL NOT DERIVED FROM `MAX_CONCURRENT_SESSIONS` IN CODE. A `2 * 15` here would tie a
// COST ceiling to a RATE ceiling and make one move when the other is tuned; the relationship is
// the justification, not the implementation — which is exactly why raising one meant REVISITING
// the other by hand, and why `test/launch-budget.test.mjs` pins the ORDERING (rate > cost) rather
// than either number.
const MAX_CHAINED_LAUNCHES = 30;
const WINDOW_MS = 15 * 60_000;

// { [channelId]: number[] } — the timestamps still inside the window, oldest first.
const spends = new Map();

// ⚠ BOUNDED, because an unbounded Map keyed by a server-minted id leaks for the life of the
// process — the trap `launch-directives.js › MAX_REMEMBERED` and `session-outbound-tag.js` both
// record. Oldest CHANNEL evicted first (insertion order), and an eviction costs at worst one
// channel a fresh budget, never a refusal it should not have had.
const MAX_TRACKED_CHANNELS = 64;

/** Drop every stamp that has aged out, and return what is left. */
function live(stamps, now) {
  const floor = now - WINDOW_MS;
  let i = 0;
  while (i < stamps.length && stamps[i] <= floor) i += 1;
  return i === 0 ? stamps : stamps.slice(i);
}

/**
 * SPEND ONE CHAINED LAUNCH FOR THIS CHANNEL. `true` when it was within budget (and the spend is
 * recorded), `false` when the budget is exhausted (and NOTHING is recorded — a refused launch
 * must not push the window forward, or a channel at the ceiling could never recover).
 *
 * ⚠ A MISSING CHANNEL ID SPENDS NOTHING AND IS REFUSED. Every real caller has one; a caller that
 * does not cannot be counted, and an uncountable chained launch is the one this exists to stop.
 */
function spend(channelId, now) {
  if (!channelId) return false;
  const at = typeof now === 'number' && Number.isFinite(now) ? now : Date.now();
  const stamps = live(spends.get(channelId) || [], at);
  if (stamps.length >= MAX_CHAINED_LAUNCHES) {
    spends.set(channelId, stamps);
    return false;
  }
  if (!spends.has(channelId) && spends.size >= MAX_TRACKED_CHANNELS) {
    spends.delete(spends.keys().next().value);
  }
  spends.set(channelId, stamps.concat(at));
  return true;
}

/** What this channel has spent inside the window. Reading never records. */
function spentIn(channelId, now) {
  if (!channelId) return 0;
  const at = typeof now === 'number' && Number.isFinite(now) ? now : Date.now();
  return live(spends.get(channelId) || [], at).length;
}

/** Test-only reset. ⚠ Named for what it is, and called from no production path. */
function resetForTests() {
  spends.clear();
}

module.exports = {
  MAX_CHAINED_LAUNCHES,
  WINDOW_MS,
  MAX_TRACKED_CHANNELS,
  spend,
  spentIn,
  resetForTests,
};
