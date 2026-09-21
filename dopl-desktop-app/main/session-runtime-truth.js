// THE RUNTIME TRUTH A RESUME RECORD MUST CARRY (2026-09-21, U10).
//
// ⚠ WHAT A RESUME ALREADY CARRIED, AND WHY IT WAS NOT ENOUGH. `session-store.js ›
// durableSessionRecord` persists `runtimeId` (which adapter) and `sdkSessionId` (the conversation
// handle), so a crash resume cannot land one platform's conversation on another's adapter. What it
// could NOT say is what that conversation was actually RUNNING AS: the model the runtime itself
// reported (as opposed to the operator's pick, which is frequently "no pick at all"), the native
// policy the session was spawned under, and whether this runtime's usage counters RESET on a
// resume — the one fact `session-park.js › resumeParked` bets the cost cap on when it zeroes both
// delta baselines.
//
// ⚠ SO THESE FIELDS ARE DIAGNOSTIC AND THEY ARE LOAD-BEARING AT THE SAME TIME, which is why they
// are persisted rather than re-derived. Re-deriving `usageBaseline` at resume time reads TODAY's
// descriptor, and a build that later flips `usageResetsOnResume` from `'unverified'` to `true`
// would silently re-interpret a record written under the old answer — i.e. it would claim a
// measurement nobody took about a conversation that already happened. A record states what was
// true when it was written; the live descriptor states what is true now; `capability.js ›
// resumeRefusal` is still the thing that DECIDES, and nothing here weakens it.
//
// ⚠ IT IS A SEPARATE FILE FROM `session-store.js` BECAUSE OF THE PURE BLOCK, NOT ONLY THE CAP.
// `durableSessionRecord` lives inside SESSION-STORE-PURE, which three suites slice and evaluate
// with `new Function` and NO injected free vars — so it cannot require a descriptor reader, and a
// helper that needs one cannot live in it. `saveRecord` (outside the block) is where the two meet.
//
// ⚠ NOTHING HERE READS A STORE, A FILE, THE ENVIRONMENT OR THE NETWORK, and it requires nothing,
// so it can be imported by a plain-node suite exactly like `mcp-connect.js` is.
//
// 🔒 PRIVACY. Every value below is either a member of a descriptor's own declared vocabulary or a
// model id. No prompt, no token, no approval payload and no filesystem path may be added to this
// shape — the record is written to `electron-store` in the clear and is read back by diagnostics.

/** Absent, in the descriptor's sense. Never `false`. */
const absent = (v) => v == null;

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

// ── THE NATIVE POLICY SUMMARY ────────────────────────────────────────────────────────────────

/**
 * One axis option's own label.
 *
 * ⚠ `''` WHEN THE ADAPTER DECLARES NO VOCABULARY AT ALL, and that is not the same case as a value
 * it no longer offers. No vocabulary means no descriptor (a runtime this build does not ship, or a
 * record from before the stamp) — reporting the STORED WORD there would present one runtime's
 * mode as though this runtime had named it. A value missing from a declared list is the other
 * case: the adapter is known and the stored word is what the session really carries, so it is
 * reported raw rather than silently dropped.
 */
function optionLabel(options, value) {
  const list = Array.isArray(options) ? options : [];
  if (!list.length) return '';
  const hit = list.find((o) => o && o.value === value);
  return (hit && typeof hit.label === 'string' && hit.label) || (value ? String(value) : '');
}

/**
 * THE NATIVE POLICY THIS SESSION WAS SPAWNED UNDER, as a REPORT rather than as a preset.
 *
 * ⚠ IT IS A REPORT OF ACTUAL VALUES AND NEVER A SYNTHETIC CROSS-RUNTIME WORD (the plan's key
 * decision 1). `Accept edits` is not a Codex approval mode — Codex separates approval policy from
 * sandbox containment and `granular` has no Claude equivalent — so this joins whatever axes THIS
 * adapter declares, in that adapter's own labels, and invents nothing. A runtime with one axis
 * produces one term; a runtime with two produces `a · b`.
 *
 * ⚠ THE SECOND AXIS IS INCLUDED ONLY WHEN THE SESSION ACTUALLY CARRIES A VALUE FOR IT. A
 * descriptor that DECLARES `toolMode.secondaryAxis` while nothing in the tree produces a value for
 * it is F-390's exact shape — a control that writes nowhere — and printing the axis's default here
 * would report a choice nobody made. Absent stays absent.
 *
 * ⚠ `''` IS A REAL ANSWER (no descriptor, or a descriptor with no Axis-A vocabulary) and the
 * caller stores `null`. Guessing a policy for a session whose runtime this build does not ship is
 * the claim this refuses.
 */
function nativePolicySummary(descriptor, session) {
  const toolMode = (descriptor && descriptor.toolMode) || {};
  const s = session || {};
  const state = s.state || {};
  const parts = [];
  const primary = optionLabel(toolMode.options, state.toolMode);
  if (primary) parts.push(primary);
  const secondary = toolMode.secondaryAxis;
  if (secondary && secondary.key) {
    // The runtime-keyed native record the launch stamped, when there is one. Read defensively:
    // this shape belongs to the launch-selection lane and a session predating it carries none.
    const native = (s.native && typeof s.native === 'object') ? s.native : {};
    const picked = native[secondary.key];
    if (!absent(picked) && picked !== '') {
      parts.push(optionLabel(secondary.options, picked));
    }
  }
  return parts.filter(Boolean).join(' · ');
}

/**
 * WHICH MODEL WAS REALLY ANSWERING — the runtime's own reported id first, the operator's pick
 * second, `null` third.
 *
 * ⚠ THE SAME ORDER `session-summary.js › liveSummary` USES, and for its reason: the pick over the
 * live id goes wrong the moment the two differ, which is the NORMAL case because "no pick" means
 * "whatever the runtime chose". ⚠ NOT COERCED THROUGH ANY RUNTIME'S MODEL TABLE — the whole point
 * of recording it is that it is what the runtime SAID, and a shared path that normalizes one
 * vendor's ids over another's is the defect U5 removed from the launch lane.
 */
function effectiveModel(session) {
  const s = session || {};
  const live = typeof s.liveModel === 'string' ? s.liveModel.trim() : '';
  if (live) return live;
  const pick = typeof s.model === 'string' ? s.model.trim() : '';
  // ⚠ `'default'` NAMES NO MODEL. It is the "ask for no model at all" member, so reporting it as
  // an effective model would be a measurement of a non-choice (`liveSummary › modelPick`'s rule).
  return pick && pick !== 'default' ? pick : null;
}

/**
 * The three fields a durable record gains, projected off a LIVE session.
 * ⚠ PLAIN VALUES, COERCED ON THE WAY OUT by {@link durableRuntimeTruth} — the same division
 * `session-io.js › baseRecord` already uses for `model` and `launchDepth`.
 */
function runtimeTruthFields(descriptor, session) {
  return {
    effectiveModel: effectiveModel(session),
    nativePolicy: nativePolicySummary(descriptor, session) || null,
    usageBaseline: usageBaseline(descriptor),
  };
}

// ⚠ A DISPLAY/DIAGNOSTIC BOUND, NOT A SECURITY ONE — but it is still a bound, because this record
// is read back into a projection and an unbounded blob from a hand-edited store must not reach it
// (`session-store.js › durableName`'s argument, at that function's own sizes).
const TRUTH_MAX = 120;

function truthString(value) {
  if (typeof value !== 'string') return null;
  const s = value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, TRUTH_MAX).trim();
  return s || null;
}

/**
 * The WHITELIST half: what a durable record may keep of the above.
 *
 * ⚠ FAIL-CLOSED ON THE ONE FIELD THAT DECIDES ANYTHING. A `usageBaseline` this build does not
 * recognise — junk, a hand-edited store, a record written before the field existed — reads as
 * `'unverified'`, which is the answer `capability.js › canResume` refuses on. The two display
 * fields are bounded strings and `null` is their ordinary value.
 */
function durableRuntimeTruth(rec) {
  const r = rec || {};
  return {
    effectiveModel: truthString(r.effectiveModel),
    nativePolicy: truthString(r.nativePolicy),
    usageBaseline: USAGE_BASELINES.indexOf(r.usageBaseline) === -1 ? USAGE_UNVERIFIED : r.usageBaseline,
  };
}

module.exports = {
  USAGE_RESETS,
  USAGE_CONTINUES,
  USAGE_UNVERIFIED,
  USAGE_BASELINES,
  usageBaseline,
  nativePolicySummary,
  effectiveModel,
  runtimeTruthFields,
  durableRuntimeTruth,
  TRUTH_MAX,
};
