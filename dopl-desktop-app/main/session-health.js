// SESSION HEALTH — "is this agent GETTING ANYWHERE", as the six facts an orchestrator can act on.
//
// ⚠ WHY IT IS ITS OWN FILE, and it is the seam `session-metrics.js` took out of
// `session-summary.js` one step further along (§1: one file, one reason to change).
// `session-summary.js` answers "which sessions exist and what identity rides with each";
// `session-metrics.js` answers "what has this one COST"; this answers "is it MAKING PROGRESS, and
// what has been refused to it". The three move on different clocks — this one moves when the
// definition of WEDGED moves, which is a product question and not a measurement one.
//
// ⚠ NOTHING HERE STARTS A COUNTER, exactly as `session-metrics.js` says of itself. Every value is
// read from where it already lives on the session object; four writers stamp them and each is at
// the one site that knows the fact:
//   `s.turns`             `session-io.js › applyCoreEvents` (the `result` event IS a turn)
//   `s.tokensAtLastPost`  `session-outbound-tag.js › nextOwnPostId` (the one place a post is
//   `s.lastOwnPostAt`      stamped, so "since it last spoke" cannot drift from "it spoke")
//   `s.deniedCalls`       `session-windowless.js › noteDenied`
//   `s.lastDeniedTool`
//   `s.lastWakeSeq`       `session-gate.js › enqueue`, beside `lastInboundSeq`, on a WAKE only
//   `s.lastWakeAt`
//
// ── ⚠ "SINCE LAST REPORT" MEANS SINCE THE LAST CHANNEL POST, AND THE CHOICE IS DELIBERATE ─────
//
// The obvious reading is "since the last row this machine pushed to `channel_sessions`", and it
// is the wrong one for the question being asked. That push is CHURN — it fires on a state change
// and is floored at ten seconds (`session-telemetry.js`) — so a delta measured against it says
// "tokens spent in the last few seconds", which no orchestrator can act on. What an orchestrator
// actually reads is the CHANNEL: the last thing it SAW from this agent is its last post. So the
// delta is "tokens burned since it last said anything", which is the number that distinguishes
// "thinking hard about the thing it told me about" from "burning money in silence".
//
// ⚠ AND IT IS WHAT MAKES `stale` COMPUTABLE AT ALL. A wedged session is not one that is quiet
// (an agent working a real task can be quiet for a long stretch — the tool's own copy says so)
// and it is not one that is spending (spending is working). It is one doing BOTH: quiet past the
// bound AND still spending. Either half alone is a normal, healthy shape and flagging it would
// teach every reader to ignore the flag.
//
// PURE below the sentinel and injected as free vars — the `session-metrics.js` /
// `session-detail.js` idiom, and the same reason: `session-metrics.js` requires this ABOVE its
// own sentinel and the summary harness injects the real thing, so one program is under test.

const { pillState } = require('./session-pill');

// ─── BEGIN SESSION-HEALTH-PURE (injectable; unit-tested via source extraction) ──────
// `pillState` is a free var from here down.

/**
 * HOW LONG A WORKING SESSION MAY BE QUIET BEFORE IT IS WORTH FLAGGING.
 *
 * ⚠ TEN MINUTES IS A PRODUCT NUMBER, NOT A TIMEOUT, AND IT DECIDES NOTHING. Nothing is ended,
 * parked, refused or retried when it passes — the flag is a WORD in a projection an orchestrator
 * reads. That is why it can be this short: the cost of a false positive is one line an
 * orchestrator may ignore, where the cost of a false negative was sixteen minutes of a live
 * session reported as `working` while every call it made was being denied.
 *
 * ⚠ IT IS DELIBERATELY NOT `SESSION_STALE_WINDOW_MS` (90s, the server's presence window). That
 * number answers "is this ROW still speaking for itself" — a fact about the REPORT — and this one
 * answers "is the AGENT getting anywhere", a fact about the run. Sharing a constant between them
 * would make one of the two questions unaskable, and the server's own render already carries the
 * argument for why its number is the presence window.
 */
const STALE_QUIET_MS = 10 * 60 * 1000;

/** A number, or null for "nothing has measured this" — `session-metrics.js › metricOrNull`'s rule,
 *  restated at this boundary because this block is sliced and evaluated with no requires. The two
 *  are pinned against each other in test/session-health.test.mjs.
 *  ⚠ `typeof` FIRST, never a bare Number(): `Number(null)` is 0, and coercing every absence into a
 *  confident zero is the one lie the whole discipline exists to prevent. */
function countOrNull(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value;
}

/**
 * WHEN THIS SESSION LAST SAID SOMETHING — its last own-channel post, else its start.
 *
 * ⚠ FALLING BACK TO `startedAt` IS WHAT MAKES A SESSION THAT HAS NEVER POSTED MEASURABLE, and
 * that session is the one the whole ticket is about: the agent that launched, went quiet, and was
 * still reported as `working` a quarter of an hour later. Falling back to `now` instead would make
 * exactly that case unflaggable forever.
 */
function lastSpokeAt(s) {
  return countOrNull(s && s.lastOwnPostAt) ?? countOrNull(s && s.startedAt);
}

/**
 * TOKENS BURNED SINCE THIS SESSION LAST POSTED — or null when nothing has measured its spend.
 *
 * ⚠ A SESSION THAT HAS NEVER POSTED REPORTS ITS WHOLE SPEND, which is the honest answer rather
 * than a special case: everything it has cost has bought its reader nothing yet.
 * ⚠ CLAMPED AT ZERO for the same reason `session-io.js` clamps its own deltas — a resumed run
 * restarts the cumulative total, and a negative "spend" is not a number anybody can read.
 */
function tokensSinceLastPost(s) {
  const spent = countOrNull(s && s.tokensSpent);
  if (spent === null) return null;
  const baseline = countOrNull(s && s.tokensAtLastPost) ?? 0;
  return Math.max(0, spent - baseline);
}

/**
 * IS THIS SESSION WEDGED? Three conditions, and ALL THREE are required.
 *
 * 1. it is WORKING — an idle session is between turns and an ended one is over; neither is stuck.
 * 2. it has been QUIET past {@link STALE_QUIET_MS} — measured from its last post, else its start.
 * 3. it is still SPENDING — `tokensDelta > 0`.
 *
 * ⚠ CONDITION 3 IS WHAT KEEPS THE FLAG WORTH READING. Quiet-and-working alone describes every
 * agent doing a long piece of work, and a flag that fires on those is a flag everybody learns to
 * ignore — which is strictly worse than no flag, because it also hides the real ones.
 * ⚠ AN UNMEASURED SPEND ANSWERS `false`, NOT `true`. "Nothing has told me what this costs" is not
 * evidence that it is stuck, and this is a claim ABOUT somebody's agent: the fail-safe direction
 * for an assertion is to withhold it.
 */
// ⚠ **THE ONE THING THIS FLAG CANNOT DO, STATED RATHER THAN DISCOVERED — F-389.** It is DERIVED
// AT PROJECTION TIME and the projection is pushed ON CHANGE, never on a timer
// (`session-state-push.js`'s whole argument). So the flag becomes true the moment the bound
// passes, and it REACHES THE SERVER on the session's next dispatch — which for a session that has
// stopped dispatching ENTIRELY may be never. The class it covers is the one that was actually
// observed: an agent that runs turns, spends tokens and posts nothing, whose every tool call
// keeps the dispatch loop alive. The class it cannot cover is a process wedged so completely that
// nothing moves, and for that one the honest reading is still the server's own — a row whose
// `updatedAt` has gone quiet under a live heartbeat. Closing the gap needs a keepalive that
// module's header REFUSES and requires a reason to be argued THERE; this ticket did not have one.
function isStale(s, now) {
  if (pillState(s && s.state) !== 'working') return false;
  const delta = tokensSinceLastPost(s);
  if (delta === null || delta <= 0) return false;
  const spoke = lastSpokeAt(s);
  if (spoke === null) return false; // no clock basis — say nothing rather than guess
  return now - spoke > STALE_QUIET_MS;
}

/**
 * THE HEALTH HALF OF A LIVE SESSION'S SUMMARY. Spread into `session-metrics.js › metrics`, which
 * is already spread into `session-summary.js › liveSummary` — so this adds no line to the
 * projection file and no second traversal anywhere.
 *
 * ⚠ EVERY COUNT IS `null` UNTIL SOMETHING MEASURES IT, and the render prints nothing for a null.
 * A session that has been denied nothing reports `deniedCalls: null` rather than `0`: this
 * projection crosses to a server where an ABSENT field means "not reported", and a confident zero
 * from a build that has not counted anything is the same lie as a zero token meter.
 * ⚠ `stale` IS THE ONE BOOLEAN, and it is always present. It is a DERIVATION over the fields
 * beside it rather than a measurement, so there is no "unmeasured" state for it to be in — the
 * honest answer when the inputs are missing is "no, I am not asserting this session is stuck",
 * which is `false`.
 */
function health(s, now) {
  return {
    turns: countOrNull(s && s.turns),
    tokensDelta: tokensSinceLastPost(s),
    stale: isStale(s, now),
    deniedCalls: countOrNull(s && s.deniedCalls),
    lastDeniedTool: (s && typeof s.lastDeniedTool === 'string' && s.lastDeniedTool) || null,
    lastWakeSeq: countOrNull(s && s.lastWakeSeq),
    lastWakeAt: countOrNull(s && s.lastWakeAt),
  };
}

// ─── END SESSION-HEALTH-PURE ────────────────────────────────────────────────────────

module.exports = {
  STALE_QUIET_MS,
  countOrNull,
  lastSpokeAt,
  tokensSinceLastPost,
  isStale,
  health,
};
