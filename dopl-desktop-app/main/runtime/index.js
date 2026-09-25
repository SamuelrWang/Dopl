// THE RUNTIME REGISTRY — the only place an adapter is named. Core asks here by id and gets back
// descriptor data or a `contract.js › RUNTIME_METHODS` runtime, so core cannot grow a vendor branch
// (`test/core-vocabulary.test.mjs`). Adapters are sealed at load (`contract.js › sealAdapter`
// throws), so a malformed one fails at require time, not at a gate decision. Electron-free.

const { sealAdapter } = require('./contract');
const capability = require('./capability');
const connectivity = require('./connectivity');
const runtimeCopy = require('./runtime-copy');
const permissionLevel = require('./permission-level');

const REGISTRY = new Map();

function register(adapter) {
  const sealed = sealAdapter(adapter);
  REGISTRY.set(sealed.descriptor.id, sealed);
  return sealed;
}

// Registration order is load-bearing: `DEFAULT_ID` is the first registered, so a session record
// carrying no runtime id still resolves to the runtime it ran on.
register(require('./claude'));
register(require('./codex'));
register(require('./cursor'));

const DEFAULT_ID = REGISTRY.keys().next().value;

/**
 * The adapter driving this session. An unknown id falls back to the default: refusing would strand
 * a session a newer build wrote, and nothing is granted by it (every gate decision is re-derived).
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
 * The runtime this session will run on, once `available()` says it can. Throws (every caller's
 * catch IS the "no agent runtime on this Mac" path); not the binary probe, not the credential probe.
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

/** The ids this Mac is connected to (`available()`, leashed and cached). Narrows nothing: every
 *  registered adapter is still offered; `acquire` re-asks at spawn. */
const connectedIds = () => connectivity.connectedIds(all());

/** Expire the standing connectivity sweep because a change was observed (`connectivity.js › expire`). */
const expireConnectivity = () => connectivity.expire();

/**
 * The adapter vocabulary a durable launch selection is read through, handed IN so
 * `main/launch-selection.js` stays pure. Resolved per call. The caller must ask `known()` before
 * trusting an id: `descriptorFor` answers the default adapter for an unknown one by design.
 */
function selectionContext() {
  const d = descriptorFor;
  return {
    ids: ids(),
    defaultId: DEFAULT_ID,
    levels: permissionLevel.LEVELS,
    known: (id) => typeof id === 'string' && REGISTRY.has(id),
    toolModeFor: (id, mode) => capability.normalizeToolMode(d(id), mode),
    levelOf: (id, tools, native) => permissionLevel.levelOf(d(id), tools, native),
    levelSettings: (id, level) => permissionLevel.levelSettings(d(id), level),
    settingText: (id, tools, native) => permissionLevel.settingText(d(id), tools, native),
    labelFor: (id) => d(id).label,
  };
}

/** A running session's effective permission: `{ runtime, level, label, setting }` in its runtime's words. */
function describePermission(runtimeId, tools, native) {
  const d = descriptorFor(runtimeId);
  return { runtime: d.label, ...permissionLevel.describe(d, tools, native) };
}

module.exports = {
  resolve, descriptorFor, runtimeFor, acquire, ids, all, connectedIds, expireConnectivity, describePermission,
  DEFAULT_ID,
  capability, // one require answers a capability question
  selectionContext,
  copy: runtimeCopy, // every operator-facing sentence about a runtime, from its own descriptor
};
