// The runtime truth a resume record carries: whether this conversation's cumulative usage resets on resume
// (`usageBaseline`). The RECORD's word beats today's descriptor (a record states what was true when it ran).
// Requires nothing; the record is stored in the clear, so no prompt, token or path may join this shape.

// Three answers; 'unverified' is one of them, not a missing value (unknown is not empty).
const USAGE_RESETS = 'resets';
const USAGE_CONTINUES = 'continues';
const USAGE_UNVERIFIED = 'unverified';
const USAGE_BASELINES = [USAGE_RESETS, USAGE_CONTINUES, USAGE_UNVERIFIED];

// `descriptor.session.usageResetsOnResume` in the record's words; absent is 'unverified' (fail closed).
function usageBaseline(descriptor) {
  const declared = descriptor && descriptor.session ? descriptor.session.usageResetsOnResume : null;
  if (declared === true) return USAGE_RESETS;
  if (declared === false) return USAGE_CONTINUES;
  return USAGE_UNVERIFIED;
}

// The field a record gains from a LIVE session: a session rebuilt from a record keeps that record's word.
function runtimeTruthFields(descriptor, session) {
  const recorded = session && session.usageBaseline;
  return {
    usageBaseline: USAGE_BASELINES.indexOf(recorded) !== -1 ? recorded : usageBaseline(descriptor),
  };
}

// The whitelist half: an unrecognised baseline reads 'unverified', which `canResume` refuses on.
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
