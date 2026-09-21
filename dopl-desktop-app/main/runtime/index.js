// THE RUNTIME REGISTRY — ⚠ THE ONLY PLACE AN ADAPTER IS NAMED.
//
// Core never requires an adapter directly. It asks here, by id, and everything it gets back is
// either pure descriptor data or one of the sixteen `contract.js › RUNTIME_METHODS`. That is what
// makes `test/core-vocabulary.test.mjs` enforceable: if core cannot name a vendor, core cannot
// grow a vendor-shaped branch, and requirement (7) — zero repeated code, adapters implement only
// declared differences — has teeth instead of discipline.
//
// ⚠ ONE ADAPTER IS REGISTERED TODAY (2026-08-31) and the behaviour is byte-identical to what
// shipped before the extraction. The registry is not speculative scaffolding: it is the seam that
// lets the SECOND adapter be a file addition rather than a branch added to 138 modules.
//
// ⚠ SEALED AT LOAD, NOT AT FIRST USE. `contract.js › sealAdapter` throws on a descriptor that
// would register with a null Axis-B enforcement point or a profile with no deny list. A
// half-registered adapter answering `null` because its descriptor never validated is the exact
// failure the contract exists to make impossible, so the failure lands at require time — loud,
// in one place — rather than at a gate decision.

const { sealAdapter } = require('./contract');
const capability = require('./capability');
// 2026-09-08 (Samuel's connectivity correction): WHICH of the registered adapters this Mac is
// actually connected to. It lives in its own file because its one reason to change is the caching
// and leash policy, not the roster — this module stays "the only place an adapter is named".
const connectivity = require('./connectivity');
// 2026-09-21 (U10): the operator-facing COPY, built from a descriptor's own label rather than from
// one vendor's name. A sibling of `capability.js` on a different clock — see that file's header.
// ⚠ IT REQUIRES NOTHING, so this line cannot cycle and cannot pull electron.
const runtimeCopy = require('./runtime-copy');

const REGISTRY = new Map();

function register(adapter) {
  const sealed = sealAdapter(adapter);
  REGISTRY.set(sealed.descriptor.id, sealed);
  return sealed;
}

register(require('./claude'));
// ⚠ THE SECOND ADAPTER (2026-08-31, port step 7), AND IT COST EXACTLY THIS LINE PLUS A DIRECTORY.
// That is the whole return on the extraction wave: no core module gained a branch, and every case
// in `test/runtime-contract.test.mjs` applied to it the moment it registered. Registration ORDER
// is load-bearing — `DEFAULT_ID` below is the FIRST registered, so a session record carrying no
// runtime id (every session written before the port) still resolves to the runtime it ran on.
register(require('./codex'));
// ⚠ THE THIRD ADAPTER (2026-08-31, port step 8), AND IT COST EXACTLY THIS LINE PLUS A DIRECTORY —
// the same price as the second. It is also the one the seam was really for: the other two are
// held-callback runtimes, and this one has no permission callback at all, so it is the first
// adapter whose `axisB.enforcementPoint` is `in-process`. Registering it is what turns
// `test/adapter-parity.test.mjs`'s Cursor census from a prediction into a measurement.
// ⚠ IT REGISTERS BUT IT DOES NOT SHIP. `descriptor.session.interrupt` is `'unverified'` (§5 item
// X0: the SDK documents no interrupt), and the design's step 8 is explicit that a runtime Dopl
// cannot stop is a runtime that does not ship. Registration is what makes the conformance suite
// measure it; the ship gate is Samuel's and is flagged in the wave report.
register(require('./cursor'));

// ⚠ THE DEFAULT IS THE FIRST REGISTERED, NOT A NAMED LITERAL. Naming one here would put a vendor
// word back in the one file whose job is to hold the only copy of it, and would make "which
// runtime does an un-stamped session get" a decision restated in two places.
const DEFAULT_ID = REGISTRY.keys().next().value;

/**
 * The adapter driving this session.
 *
 * ⚠ FAIL-CLOSED TO THE DEFAULT, DELIBERATELY, AND IT IS NOT THE SAME KIND OF FAIL-CLOSED AS A
 * GATE. An unknown runtime id is a session record written by a build that knew a runtime this one
 * does not — a downgrade, or a stored id from a future wave. Refusing would strand the session
 * with no way to end it; answering the default runs it under the runtime this build actually
 * ships, which is the only one whose behaviour is knowable here. Nothing is GRANTED by this
 * choice: every posture, profile and gate decision is re-derived per call.
 */
function resolve(runtimeId) {
  const id = typeof runtimeId === 'string' ? runtimeId.trim() : '';
  return (id && REGISTRY.get(id)) || REGISTRY.get(DEFAULT_ID);
}

/** The frozen descriptor for a runtime id — what the UI and the IPC bridge read. */
const descriptorFor = (runtimeId) => resolve(runtimeId).descriptor;

/** The behaviour half. Core calls only `contract.js › RUNTIME_METHODS` on it. */
const runtimeFor = (runtimeId) => resolve(runtimeId).runtime;

/**
 * The runtime this session will run on, once it is known to be usable — the successor to the
 * cached SDK handle every spawn used to be handed.
 *
 * ⚠ IT THROWS RATHER THAN RETURNING A FLAG, and that is deliberate rather than lazy: every caller
 * already wraps the acquire in a `try` whose catch IS the "no agent runtime on this Mac" path
 * (`session-launch.js` answers `{skipped:'no-sdk'}`, `session-park.js` refuses the resume). A
 * returned flag would have moved one refusal into four `if`s that could each forget it.
 *
 * ⚠ IT IS NOT THE BINARY PROBE AND NOT THE CREDENTIAL PROBE. "Can the runtime module load",
 * "is there an executable on PATH" and "is this Mac signed in" are three questions with three
 * answers; collapsing them is how a machine with a perfectly good bundled binary came to be told
 * channel requests could not be answered.
 */
async function acquire(runtimeId) {
  const rt = runtimeFor(runtimeId);
  const gate = await rt.available();
  if (!gate.ok) throw new Error(gate.reason || 'runtime unavailable');
  return rt;
}

/** Every registered id, in registration order. */
const ids = () => Array.from(REGISTRY.keys());

/** Every sealed adapter, for the conformance suites. */
const all = () => Array.from(REGISTRY.values());

/**
 * The ids of the registered runtimes this Mac is CONNECTED to — `available()`, leashed and cached.
 *
 * ⚠ IT NARROWS NOTHING (2026-09-08, Samuel: *"even if the user does not have codex or cursor
 * connected, I still want them to be options there … I did not say to remove them"*). Every
 * registered adapter is still offered everywhere; this only says which of them would start today.
 * ⚠ NOT A SUBSTITUTE FOR `acquire`, which re-asks at spawn and is the refusal an operator reads.
 */
const connectedIds = () => connectivity.connectedIds(all());

/**
 * THE VALIDATION CONTEXT A DURABLE LAUNCH SELECTION IS CHECKED AGAINST (2026-09-21, U5).
 *
 * ⚠ **IT EXISTS SO `main/launch-selection.js` CAN STAY PURE.** That module owns the versioned
 * record's SHAPE — which version is current, what migrates, what a future version falls back to —
 * and it must be sliceable and evaluable standalone, like every other validator in this family.
 * The vocabulary it validates against belongs to the adapters, so the vocabulary is handed IN.
 *
 * ⚠ EVERY MEMBER IS RESOLVED PER CALL, AND THAT IS WHY IT IS A FUNCTION RATHER THAN A CONSTANT.
 * `descriptorFor` fail-closes an unknown id to the DEFAULT adapter, so a record whose runtime this
 * build does not ship is validated against the runtime it will actually launch on rather than
 * against nothing.
 *
 * ⚠ THE CALLER MUST STILL ASK `known()` BEFORE IT TRUSTS A RUNTIME ID. `descriptorFor('borg')`
 * answers the default adapter's descriptor by design (a downgrade must not strand a channel), so a
 * storage path that wants to know whether the id is REAL has to ask — otherwise a stored
 * `runtime: 'borg'` would validate cleanly and then read back as a pick nobody made.
 */
function selectionContext() {
  return {
    ids: ids(),
    defaultId: DEFAULT_ID,
    known: (id) => typeof id === 'string' && REGISTRY.has(id),
    toolModeFor: (id, mode) => capability.normalizeToolMode(descriptorFor(id), mode),
    narrowestToolFor: (id) => capability.narrowestToolMode(descriptorFor(id)),
    storeModelFor: (id, value) => capability.storeModelPick(descriptorFor(id), value),
    nativeFor: (id, raw) => capability.normalizeNative(descriptorFor(id), raw),
    labelFor: (id) => descriptorFor(id).label,
  };
}

module.exports = {
  register, resolve, descriptorFor, runtimeFor, acquire, ids, all, connectedIds,
  DEFAULT_ID,
  capability, // re-exported so a consumer needs ONE require to ask a capability question
  selectionContext, // U5: the adapter vocabulary `main/launch-selection.js` validates against
  // U10 (2026-09-21): every operator-facing SENTENCE about a runtime, built from that runtime's
  // own descriptor. Re-exported here for `capability`'s reason — a core module asking "what does
  // this runtime tell the operator" must not need a second require, and must not reach past the
  // registry into an adapter directory to find out.
  copy: runtimeCopy,
};
