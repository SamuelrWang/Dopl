// WHICH AGENT RUNTIME THIS CHANNEL'S AGENTS LAUNCH ON — LOCAL ONLY, never sent to Dopl.
//
// ⚠ A DURABLE PER-CHANNEL PICK, AND IT IS THE `model`'S SHAPE, NOT THE POSTURE'S (2026-08-31,
// runtime-adapter port wave D). Its own file for the same reason `orchestrator-consent.js` and
// `template-approval.js` have theirs: `channel-prefs.js` changes when a channel PREFERENCE moves,
// and this changes when the set of registered adapters does — a different clock, and the only
// module in this family that has to ask `main/runtime/index.js` anything.
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

const Store = require('electron-store');
const { diag } = require('./diag');
const runtimeRegistry = require('./runtime');

// The same `electron-store` instance shape `channel-prefs.js` uses — one JSON file per app, so a
// second handle reads and writes the same document. Same idiom as `orchestrator-consent.js`.
const store = new Store();

const CHANNEL_RUNTIME_KEY = 'channelRuntime'; // { [channelId]: '<runtime id>' }

/**
 * Coerce an arbitrary value to a REGISTERED runtime id, or `''` for the default.
 *
 * ⚠ `''` IS THE ONLY SPELLING OF "NO PICK", so a channel that never chose and a channel whose
 * pick was cleared are the same record — the rule auto-send, agent chaining and the posture's
 * `model` all follow, and it is what keeps a reader from growing a third state to get wrong.
 */
function normalizeRuntimeId(raw) {
  const id = typeof raw === 'string' ? raw.trim() : '';
  if (!id) return '';
  return runtimeRegistry.ids().indexOf(id) === -1 ? '' : id;
}

function allRuntimes() {
  const map = store.get(CHANNEL_RUNTIME_KEY);
  return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
}

/**
 * THE CHANNEL'S CHOSEN RUNTIME, as a registered id, or `''` for the default (the first
 * registered adapter). ⚠ Reading never writes, and an unknown stored id reads as `''` rather
 * than being repaired — a downgrade must not silently rewrite the operator's pick away.
 */
function getChannelRuntime(channelId) {
  if (!channelId) return '';
  try {
    return normalizeRuntimeId(allRuntimes()[channelId]);
  } catch (_err) {
    return ''; // an unreadable store is the default runtime, never a refusal
  }
}

/**
 * Persist the channel's runtime. ⚠ AN UNKNOWN ID CLEARS THE KEY rather than being stored: the
 * store is not a place to park a value this build cannot resolve, and the SPA's own list comes
 * from the same registry, so the only way to reach this branch is a hand-edited store or a
 * version-skewed page.
 * ⚠ RETURNS THE VALUE THE STORE ACTUALLY HOLDS (re-read on failure), which is what lets the IPC
 * layer answer `{ok:false}` and the SPA revert an optimistic pick — `orchestrator-consent.js`'s
 * rule, for its reason.
 */
function setChannelRuntime(channelId, raw) {
  if (!channelId) return '';
  const id = normalizeRuntimeId(raw);
  const before = getChannelRuntime(channelId);
  try {
    const map = allRuntimes();
    const next = { ...map };
    if (id) next[channelId] = id;
    else delete next[channelId];
    store.set(CHANNEL_RUNTIME_KEY, next);
  } catch (err) {
    diag('channel-runtime: could not persist the runtime pick —', err && err.message);
    return getChannelRuntime(channelId);
  }
  diag('channel-runtime:', String(channelId).slice(0, 8), id || '(default)');
  // ⚠ **A RUNTIME SWITCH CLEARS THE CHANNEL'S MODEL STAMP** (2026-09-06, z5ztx9ts's audit).
  //
  // MODEL ROSTERS ARE PER-RUNTIME. A channel stamped `claude-sonnet-5` that later switches to
  // codex or cursor is carrying an id THAT RUNTIME HAS NEVER HEARD OF — and this is not a
  // cosmetic mismatch, because `channel-prefs.js › getLaunchModel` sits ABOVE the SDK default in
  // the launch precedence chain. The stale id would WIN instead of stepping aside, so the new
  // runtime would be asked for a model that does not exist there rather than falling back to its
  // own default.
  //
  // ⚠ IT BECAME REACHABLE WITH SAMUEL'S BACK-FILL RULING THE SAME DAY. Before it, an unset
  // channel stored NO model and had nothing to go stale; now every channel the operator touches
  // carries a real id, so "switched runtime while stamped" is the ordinary path rather than an
  // edge case. The ruling stands — this only keeps it honest across a switch.
  //
  // ⚠ CLEARED, NOT TRANSLATED. There is no mapping between one vendor's roster and another's, and
  // inventing one would be this file claiming to know which of Codex's models "is" Sonnet. Absent
  // is a state the chain already handles: the new runtime's own default applies, and the operator
  // picks again from a list that is actually its.
  //
  // ⚠ ONLY ON A REAL CHANGE, and only after the write LANDED. Re-selecting the same runtime must
  // not wipe a deliberate pick, and a failed write returns above without reaching this line.
  if (id !== before) clearLaunchModelForRuntimeSwitch(channelId, before, id);
  return id;
}

/**
 * Drop the channel's stored launch model after its runtime changed. Best-effort and never in the
 * way of the switch itself.
 *
 * ⚠ LAZY-REQUIRED, the idiom this tree uses at every module edge that touches `channel-prefs.js`
 * (`session-private.js › channelMessageMode` states it): that module instantiates an
 * electron-store at load, and plain-node callers of this file must keep working.
 *
 * ⚠ IT WRITES THROUGH `setLaunchPosture`, NOT INTO THE STORE. The posture record validates BOTH
 * axes on write and refuses the whole thing on an unknown value; reaching around it to delete one
 * field would be a second writer of a record whose whole design is that it has one.
 */
function clearLaunchModelForRuntimeSwitch(channelId, before, after) {
  try {
    const prefs = require('./channel-prefs');
    const posture = prefs.getLaunchPosture(channelId);
    if (!posture || !posture.model) return; // nothing stamped — nothing to go stale
    prefs.setLaunchPosture(channelId, {
      tools: posture.tools,
      messages: posture.messages,
      model: null,
    });
    diag('channel-runtime: cleared the model stamp on a runtime switch',
      String(channelId).slice(0, 8), (before || '(default)') + ' -> ' + (after || '(default)'));
  } catch (err) {
    // ⚠ A FAILURE HERE COSTS A STALE STAMP, NEVER THE SWITCH. Loud in the log, silent to the
    // caller: the operator asked to change runtime and that has already happened.
    diag('channel-runtime: could not clear the model stamp —', (err && err.message) || String(err));
  }
}

module.exports = {
  CHANNEL_RUNTIME_KEY,
  normalizeRuntimeId,
  getChannelRuntime,
  setChannelRuntime,
};
