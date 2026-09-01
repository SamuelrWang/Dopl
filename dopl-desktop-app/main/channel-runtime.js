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
  return id;
}

module.exports = {
  CHANNEL_RUNTIME_KEY,
  normalizeRuntimeId,
  getChannelRuntime,
  setChannelRuntime,
};
