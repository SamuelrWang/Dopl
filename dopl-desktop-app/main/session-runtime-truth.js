// THE RUNTIME TRUTH A RESUME RECORD CARRIES: whether this conversation's cumulative usage resets
// on a resume (`usageBaseline`). `session-park.js › resumeParked` decides the token delta baseline
// from it, and the RECORD's word beats today's descriptor: a record states what was true when the
// conversation ran. `capability.js › resumeRefusal` still decides whether a resume happens at all.
//
// Separate from `session-store.js` because `durableSessionRecord` lives in a pure block that may
// not require a descriptor reader; `saveRecord` is where the two meet. Requires nothing.
// The record is written to `electron-store` in the clear: no prompt, token or path joins this shape.

// ── THE USAGE BASELINE ───────────────────────────────────────────────────────────────────────
//
// ⚠ THREE ANSWERS, AND `'unverified'` IS ONE OF THEM RATHER THAN A MISSING VALUE. INVARIANTS §11:
// UNKNOWN is not EMPTY. A runtime that has not been measured is a different record from one
// measured to continue its totals, and collapsing them is how a resume comes to be attempted on
// the strength of an absent field.
const USAGE_RESETS = 'resets';
const USAGE_CONTINUES = 'continues';
const USAGE_UNVERIFIED = 'unverified';
const USAGE_BASELINES = [USAGE_RESETS, USAGE_CONTINUES, USAGE_UNVERIFIED];

/**
 * How this runtime's cumulative usage behaves across a resume, in the record's own vocabulary.
 *
 * ⚠ IT IS A TRANSLATION OF `descriptor.session.usageResetsOnResume`, NOT A SECOND OPINION ABOUT
 * IT. The descriptor's field is a tri-state (`true` / `false` / `'unverified'`) that
 * `capability.js › canResume` reads as a REFUSAL; this is the same three answers named so a
 * persisted record is readable without a boolean anyone has to remember the polarity of.
 * ⚠ AN ABSENT DECLARATION IS `'unverified'`, which is the fail-closed direction: `canResume`
 * already refuses anything that is not exactly `true`.
 */
function usageBaseline(descriptor) {
  const declared = descriptor && descriptor.session ? descriptor.session.usageResetsOnResume : null;
  if (declared === true) return USAGE_RESETS;
  if (declared === false) return USAGE_CONTINUES;
  return USAGE_UNVERIFIED;
}

/**
 * The field a durable record gains, projected off a LIVE session. A session rebuilt from a record
 * carries that record's word (`s.usageBaseline`) and keeps it across every later save; a session
 * this process launched answers off its descriptor.
 */
function runtimeTruthFields(descriptor, session) {
  const recorded = session && session.usageBaseline;
  return {
    usageBaseline: USAGE_BASELINES.indexOf(recorded) !== -1 ? recorded : usageBaseline(descriptor),
  };
}

/**
 * The WHITELIST half: what a durable record may keep. ⚠ FAIL-CLOSED: a baseline this build does not
 * recognise (junk, a hand-edited store, a record from before the field) reads as `'unverified'`,
 * which `capability.js › canResume` refuses on.
 */
function durableRuntimeTruth(rec) {
  const r = rec || {};
  return {
    usageBaseline: USAGE_BASELINES.indexOf(r.usageBaseline) === -1 ? USAGE_UNVERIFIED : r.usageBaseline,
  };
}

module.exports = {
  USAGE_RESETS,
  USAGE_CONTINUES,
  USAGE_UNVERIFIED,
  USAGE_BASELINES,
  usageBaseline,
  runtimeTruthFields,
  durableRuntimeTruth,
};
