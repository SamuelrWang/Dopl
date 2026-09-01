// THE INBOUND DIRECTION-RATE BOUND — what stops an agent-to-agent direction loop (2026-08-31,
// Samuel's same-owner directions ruling; the bound F-374 wished for).
//
// ── WHY THIS EXISTS NOW ──────────────────────────────────────────────────────────────────────
//
// F-374 recorded the CROSS-machine direction loop as unbounded and ACCEPTED, and the reason it
// was acceptable was that the in-machine one was closed by construction: `direct_agent` was on no
// own-channel allow list, so a desktop-run agent could not file a direction at all. Samuel's
// 2026-08-31 ruling opens that lane (`session-own-direct.js`), so the loop the finding described
// is now available on ONE MACHINE, at loopback speed:
//
//     A directs B  ->  B's turn ends  ->  B directs A  ->  A's turn ends  ->  A directs B  ...
//
// ⚠ **A DEPTH COLUMN IS NOT AVAILABLE AND THE LAUNCH LANE'S REASON APPLIES VERBATIM.**
// `channel_agent_directions` has fourteen columns and none of them counts hops;
// `agent-direction-wire.js › directionFrom` is a literal whitelist over the ones the table has, so
// even a smuggled field would be dropped on the way in. Counting generations over a number that
// cannot cross the wire is the bound-in-name-only `session-own-launch.js` refuses to build.
//
// ── ⚠ SO THE BOUND IS A RATE, AT THE DELIVERY END, PER TARGET SESSION ────────────────────────
//
// **AT THE DELIVERY END** because every hop of every loop — same-machine or cross-machine — has
// to land a TURN on some session. Bounding what a session will RECEIVE therefore bounds the loop
// from both sides at once, and covers the cross-machine case that had no bound at all. Bounding
// what a session may SEND would have needed a counter at the permission gate, which is pure and
// decides without mutating, and would have missed the cross-machine half entirely.
//
// **PER TARGET SESSION** (`agent_id`, the 8-char instance id) rather than per channel or per
// machine, because that is the unit a runaway conversation actually consumes: two agents talking
// in a circle spend one session's turns each. A machine-wide counter would let one loop starve
// every unrelated agent; a per-channel one would do the same inside a room.
//
// ⚠ **IT CANNOT REACH THE OPERATOR'S OWN COMPOSER, AND THAT IS STRUCTURAL RATHER THAN CHECKED.**
// The operator's messages to their own agent go through `session-reopen.js › messageByTask`
// directly from an `appWindowOnly` IPC op and never touch this module; the only caller is
// `agent-directions.js › handle`, the claim funnel for rows that arrived over the network. A
// human who types fast is not rate-limited by anything here.
//
// ⚠ **THE REFUSAL IS `busy`, WHICH IS ALREADY THE RIGHT SENTENCE.** The five-word direction
// vocabulary (`agent-direction-wire.js › REFUSAL_REASONS`) is closed, and `busy`'s MCP-side
// sentence reads: *"the machine declined FOR NOW … it is reasonable to ask again in a minute or
// two, once, and to stop if it refuses the same way twice."* That is exactly true of a rate bound
// and it tells a looping agent to stop. A sixth word would be a column CHECK, a route enum, a
// wire map and a sentence, bought for a shade of meaning.
//
// ⚠ **IT REFUSES AFTER THE CLAIM, NOT BEFORE IT.** Standing down silently before claiming would
// leave the row pending until its 10-minute TTL, so the caller learns nothing for ten minutes and
// the honest answer arrives as an expiry. Claiming and then deciding `busy` gives the caller a
// real answer in one round trip — the same reasoning `launch-directives.js` uses for refusing
// rather than ignoring once it has decided the row is its own.
//
// PURE — no electron, no store, no require. `test/direction-rate.test.mjs` drives it with an
// injected clock.

// ⚠ THE TWO NUMBERS, AND WHY THEY ARE THESE. A loop needs a full turn per hop, and a turn is
// seconds to minutes — so SIX directions inside five minutes is already faster than any real
// orchestrator/worker exchange and is reached by a tight loop almost immediately. It is also
// generous enough that a legitimate supervisor correcting one worker three or four times during a
// piece of work never sees it.
// ⚠ THE WINDOW IS ROLLING, NOT A BUCKET THAT RESETS. A fixed bucket lets a loop spend the whole
// allowance at every boundary, which is twice the rate at exactly the moment it matters.
const MAX_DIRECTIONS = 6;
const WINDOW_MS = 5 * 60_000;

// { [agentId]: number[] } — the timestamps still inside the window, oldest first.
const seen = new Map();

// ⚠ BOUNDED, oldest AGENT evicted first by insertion order — the idiom `launch-directives.js ›
// MAX_REMEMBERED` and `session-outbound-tag.js` both follow. Comfortably above
// `session-windowless.js › MAX_CONCURRENT_SESSIONS` (15 since 2026-09-01), so a live session
// can never be evicted by its own siblings; the slack is for ids that have already settled.
const MAX_TRACKED_AGENTS = 64;

/** Drop every stamp that has aged out, and return what is left. */
function live(stamps, now) {
  const floor = now - WINDOW_MS;
  let i = 0;
  while (i < stamps.length && stamps[i] <= floor) i += 1;
  return i === 0 ? stamps : stamps.slice(i);
}

/**
 * MAY THIS DIRECTION BE DELIVERED TO THIS AGENT? `true` records the delivery and admits it;
 * `false` means the session is over its inbound rate and the caller should decide `busy`.
 *
 * ⚠ A REFUSAL RECORDS NOTHING, so a session at the ceiling recovers as its oldest stamp ages out
 * rather than being held there by the very calls it is refusing.
 * ⚠ A MISSING AGENT ID IS REFUSED. Every real caller has one (`directionFrom` hard-fails a row
 * without it), and an uncountable delivery is the one this exists to stop.
 */
function admit(agentId, now) {
  if (!agentId) return false;
  const at = typeof now === 'number' && Number.isFinite(now) ? now : Date.now();
  const stamps = live(seen.get(agentId) || [], at);
  if (stamps.length >= MAX_DIRECTIONS) {
    seen.set(agentId, stamps);
    return false;
  }
  if (!seen.has(agentId) && seen.size >= MAX_TRACKED_AGENTS) {
    seen.delete(seen.keys().next().value);
  }
  seen.set(agentId, stamps.concat(at));
  return true;
}

/** What this agent has received inside the window. Reading never records. */
function receivedIn(agentId, now) {
  if (!agentId) return 0;
  const at = typeof now === 'number' && Number.isFinite(now) ? now : Date.now();
  return live(seen.get(agentId) || [], at).length;
}

/** Test-only reset. ⚠ Named for what it is, and called from no production path. */
function resetForTests() {
  seen.clear();
}

module.exports = {
  MAX_DIRECTIONS,
  WINDOW_MS,
  MAX_TRACKED_AGENTS,
  admit,
  receivedIn,
  resetForTests,
};
