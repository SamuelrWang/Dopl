// WHICH AGENT RUNTIME THIS CHANNEL'S AGENTS LAUNCH ON — LOCAL ONLY, never sent to Dopl.
//
// ⚠ A DURABLE PER-CHANNEL PICK, AND IT IS THE `model`'S SHAPE, NOT THE POSTURE'S (2026-08-31,
// runtime-adapter port wave D). Its own file for the same reason `orchestrator-consent.js` and
// `template-approval.js` have theirs: `channel-prefs.js` changes when a channel PREFERENCE moves,
// and this changes when the set of registered adapters does — a different clock, and the only
// module in this family that has to ask `main/runtime/index.js` anything.
//
// ⚠ **THE PICK STOPPED BEING ITS OWN RECORD ON 2026-09-21 (U5), AND THIS FILE IS NOW THE NAMED
// DOOR ONTO ONE FIELD OF THE CHANNEL'S LAUNCH SELECTION.** The reason is the two rulings U5
// encodes: a runtime SELECTS BETWEEN per-runtime model and native settings stored side by side
// (`main/launch-selection.js › byRuntime`), so the pick and the things it selects between cannot
// live in two records that a crash, a downgrade or a failed write could leave disagreeing. What
// did NOT change is anything below: what may be stored, what an unknown id does, and why a pick
// may travel where a posture may not.
//
// ── ⚠ WHY IT IS NOT PART OF THE LAUNCH POSTURE, WHICH IS THE FIRST THING TO ASK ──────────────
//
// `channel-prefs.js › getLaunchPosture` carries the two permission axes and has exactly ONE
// consumer, and that COUNT is what keeps H2 closed: a stored posture may only ever reach a spawn
// a human is attending. The model rides beside it as a THIRD FIELD with a SECOND reader, because
// it grants nothing and reaches no gate. **The runtime is the model's kind of decision, not the
// posture's**, and the argument is worth stating rather than inheriting:
//
//   ⚠ PICKING A RUNTIME WIDENS NOTHING. Every adapter re-derives the WHOLE gate for itself —
//   its own deny lists per profile (`runtime.toolConfigFor`), its own Axis-A vocabulary
//   (`runtime.axisAAllows`), its own windowless floor — and `main/runtime/contract.js` REFUSES to
//   register one that cannot enforce them. There is no runtime whose selection opens something
//   another runtime closed: the four gate steps that run before Axis A (hard-deny, the audience
//   belt, the Axis-B branch, the profile's own deny list) are core's on every one of them.
//
//   ⚠ SO A PEER-TRIGGERED WAKE AND A RESUME MAY INHERIT IT, and they must — a channel whose
//   operator chose Codex would otherwise answer its peers on a different vendor's model, on a
//   different credential, which is the surprise the whole port exists to avoid. That is the
//   opposite of the posture's rule and the same as the model's.
//
// ⚠ FAIL-CLOSED MEANS "THE DEFAULT RUNTIME", NOT "REFUSE". An absent, corrupt or UNKNOWN value
// answers `''`, which `main/runtime/index.js › resolve` reads as the default adapter — the one
// runtime this build is certain it ships. Refusing instead would strand a channel whose stored id
// belongs to a build that knew an adapter this one does not (a downgrade), with no way to launch
// anything at all. Nothing is granted by that choice; every posture and profile is re-derived.
//
// ⚠ VALIDATED AGAINST THE REGISTRY, NOT AGAINST A LIST HERE. `runtimeRegistry.ids()` is the only
// enumeration of what this build ships, and a second copy in this file is exactly the drift
// `main/runtime/index.js`'s header calls the point of having a registry at all.
//
// PRIVACY — electron-store, local to this Mac. Never POSTed, never in a channel message. The diag
// line carries the channel id PREFIX and the runtime id, both non-secret.

// ⚠ NO `electron-store` HANDLE SINCE 2026-09-21 (U5). This file opened its own and wrote the
// `channelRuntime` map directly; the pick lives on the channel's launch selection now, so every
// read and write goes through `channel-prefs.js`'s one validating writer. A second handle on the
// same document is a second writer of a record whose whole design is that it has one.
const { diag } = require('./diag');
const runtimeRegistry = require('./runtime');

// ⚠ **THE LEGACY KEY, AND IT IS NO LONGER THE AUTHORITY (2026-09-21, U5).** The pick now rides
// the channel's VERSIONED LAUNCH SELECTION (`main/launch-selection.js`), beside the per-runtime
// model and native settings it selects between — which is what makes "switch to Codex and back
// and find your Claude model still there" expressible at all. This key survives as
// `channel-prefs.js`'s MIGRATION SOURCE (a channel with no selection record seeds its runtime from
// here) and as its DOWNGRADE MIRROR (every selection write re-stamps it), so an older build reads
// the pick actually in force. Nothing in this file reads it directly any more.
const CHANNEL_RUNTIME_KEY = 'channelRuntime'; // LEGACY MIRROR: { [channelId]: '<runtime id>' }

// ⚠ LAZY, the idiom this tree uses at every module edge that touches `channel-prefs.js`: that
// module instantiates an electron-store at load, it requires THIS file's sibling registry, and
// plain-node callers of this file must keep working.
const prefs = () => require('./channel-prefs');

/**
 * Coerce an arbitrary value to a REGISTERED runtime id, or `''` for the default.
 *
 * ⚠ `''` IS THE ONLY SPELLING OF "NO PICK", so a channel that never chose and a channel whose
 * pick was cleared are the same record — the rule agent chaining and the selection's own model
 * field both follow, and it is what keeps a reader from growing a third state to get wrong.
 */
function normalizeRuntimeId(raw) {
  const id = typeof raw === 'string' ? raw.trim() : '';
  if (!id) return '';
  return runtimeRegistry.ids().indexOf(id) === -1 ? '' : id;
}

/**
 * THE CHANNEL'S CHOSEN RUNTIME, as a registered id, or `''` for the default (the first
 * registered adapter). ⚠ Reading never writes, and an unknown stored id reads as `''` rather
 * than being repaired — a downgrade must not silently rewrite the operator's pick away.
 */
function getChannelRuntime(channelId) {
  if (!channelId) return '';
  try {
    return normalizeRuntimeId(prefs().getLaunchSelection(channelId).runtime);
  } catch (_err) {
    return ''; // an unreadable store is the default runtime, never a refusal
  }
}

// ── ⚠ `setChannelRuntime` IS DELETED (2026-09-21, U5) ──────────────────────────────
//
// It persisted the pick into this file's own store key and then, since 2026-09-06, CLEARED the
// channel's stored model as a side effect. Both halves are gone and neither is coming back:
//
//   THE WRITE   the pick is a FIELD of the channel's versioned launch selection, so it is written
//               by the record's ONE validating writer (`channel-prefs.js › setLaunchSelection`),
//               in the same write as the messaging axis and the runtime-keyed settings it selects
//               between. A named door that issued a SECOND store write is exactly how a rejected
//               posture came to half-apply a runtime.
//   THE CLEAR   Samuel's Decisions #1 and #2: Claude → Codex → Claude restores BOTH remembered
//               model choices and BOTH native settings, translating neither. The clear existed
//               because ONE global model field could not hold two rosters and a stale id WON over
//               the new runtime's default; a runtime-keyed record makes the stale id unreachable
//               from the wrong adapter by construction.
//
// ⚠ **A ZERO-CALLER EXPORT IS NOT A FREE SEAM.** `test/session-preset-start.js`'s writer census
// is what keeps H2 honest — "nothing on the session path re-arms its own future" — and it can only
// stay honest if every writer it enumerates is a writer something actually reaches. Leaving this
// here would have added a name to that census that nothing calls, which reads as coverage.
//
// ⚠ IF SOMETHING NEEDS TO SET A CHANNEL'S RUNTIME: `channel-prefs.js › setLaunchSelection(id,
// { runtime })`. It is own-key, so it leaves every other field alone.

module.exports = {

  CHANNEL_RUNTIME_KEY,
  normalizeRuntimeId,
  getChannelRuntime,
};
