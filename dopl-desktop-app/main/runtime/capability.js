// CAPABILITY PREDICATES — the questions core asks a descriptor. The one place `null` is
// interpreted: it hides a control almost everywhere and refuses an action in the four
// `contract.js › LAUNCH_BLOCKING` places. Hide, never gray.

const selection = require('./selection-vocabulary');

// ── SESSION LIFECYCLE ────────────────────────────────────────────────────────────────────────

// Measured in either direction. `'unverified'` and absent are not: zeroing the baseline re-bills a
// runtime whose totals continue, and keeping it zeroes every later turn of one that restarts.
const usageBaselineMeasured = (d) => d.usageResetsOnResume === true || d.usageResetsOnResume === false;

/** May a parked conversation be resumed? Refuses (not hides) when the usage baseline is unmeasured. */
function canResume(descriptor) {
  const d = (descriptor && descriptor.session) || {};
  return d.resume === true && usageBaselineMeasured(d);
}

/** Why a resume was refused, for the operator. `null` when it was not. */
function resumeRefusal(descriptor) {
  const d = (descriptor && descriptor.session) || {};
  if (d.resume !== true) return 'this runtime cannot resume a conversation';
  if (usageBaselineMeasured(d)) return null;
  return 'this runtime\'s usage accounting on resume is unverified, so a resume could not bill it honestly';
}

// `session-runtime-truth.js`'s two measured words, restated because the runtime layer may not
// depend on core; `test/session-runtime-truth.test.mjs` holds them equal.
const USAGE_BASELINE_RESETS = 'resets';
const USAGE_BASELINE_CONTINUES = 'continues';

/**
 * Must a resume zero the cumulative-usage delta baseline? The durable record's word (`recorded`)
 * beats today's descriptor; only a measured `true` zeroes, because zeroing a runtime whose totals
 * continue re-bills the whole thread.
 */
function resumeZeroesBaseline(descriptor, recorded) {
  if (recorded === USAGE_BASELINE_RESETS) return true;
  if (recorded === USAGE_BASELINE_CONTINUES) return false;
  return ((descriptor && descriptor.session) || {}).usageResetsOnResume === true;
}

const canSwitchModelLive = (d) => !!(d && d.session && d.session.liveModelSwitch === true);

// ── AXIS A + AXIS B ──────────────────────────────────────────────────────────────────────────

const windowlessToolFloorValue = (d) => (d && d.toolMode && d.toolMode.windowlessFloor) || null;

/** This runtime's Axis-A modes, narrowest first. The order is load-bearing: `[0]` is where every
 *  unknown value fail-closes and the last entry is the widest. */
const toolModes = (d) => ((d && d.toolMode && d.toolMode.options) || []).map((o) => o.value);

const narrowestToolMode = (d) => toolModes(d)[0] || null;

/** The widest mode this runtime offers; still bounded by hard-deny, which no mode opens. */
function widestToolMode(d) {
  const modes = toolModes(d);
  return modes.length ? modes[modes.length - 1] : null;
}

/** Fail-closed coercion of a stored Axis-A mode: anything unrecognised is the narrowest. */
function normalizeToolMode(d, mode) {
  const modes = toolModes(d);
  return modes.indexOf(mode) === -1 ? (modes[0] || null) : mode;
}

/**
 * Axis A's windowless floor, widen-only: a session below the floor is raised, never narrowed. A
 * windowless session has no gate surface, so a gated tool there is a silent deny of the reads its
 * prompt orders. `null` (no orderable floor) refuses the windowless launch — never a guessed mode;
 * a `null` mode fail-closes at `axisAAllows`, where a throw would crash the query.
 */
function floorWindowlessTool(d, mode) {
  const floor = windowlessToolFloorValue(d);
  const modes = toolModes(d);
  const at = modes.indexOf(normalizeToolMode(d, mode));
  const target = modes.indexOf(floor);
  if (target === -1) return null;
  return at > target ? modes[at] : floor;
}

/** Why a WINDOWLESS launch is refused on this runtime (`LAUNCH_BLOCKING`). `null` when it is not. */
function windowlessFloorRefusal(descriptor) {
  const floor = windowlessToolFloorValue(descriptor);
  const label = (descriptor && descriptor.label) || 'this runtime';
  if (floor == null) {
    return `${label} declares no windowless tool floor, and a session with no gate surface would `
      + 'silently deny every tool call it makes — including the reads it is told to make';
  }
  if (toolModes(descriptor).indexOf(floor) === -1) {
    return `${label} floors an unattended session to "${floor}", which is not one of the modes it `
      + 'declares, so the floor cannot be ordered against the session\'s own mode';
  }
  return null;
}

/** The tools whose grant key is scoped to a resolved directory (`session-grant-keys.js`). */
const editScopedTools = (d) => ((d && d.toolMode && d.toolMode.editScopedTools) || []).slice();

/** The Axis-A taxonomy as declared data, for pinning. A gate decision asks `axisAAllows`, never these. */
function toolTaxonomy(d) {
  const t = (d && d.toolMode && d.toolMode.taxonomy) || {};
  const copy = (v) => (Array.isArray(v) ? v.slice() : []);
  return {
    auto: copy(t.auto), bypass: copy(t.bypass), bypassReads: copy(t.bypassReads),
    edits: copy(t.edits), escalation: copy(t.escalation),
  };
}

/**
 * The warning a launch carries when this runtime's Axis B is not op-scoped (`null` when it is).
 * Unreadable input gates every channel call as a whole tool — over-restrictive, never open — so it
 * warns rather than refuses.
 */
function axisBOpScopedWarning(descriptor) {
  const scoped = descriptor && descriptor.axisB && descriptor.axisB.opScoped;
  if (scoped === true) return null;
  const label = (descriptor && descriptor.label) || 'this runtime';
  const consequence = 'so every channel call gates as a whole tool, READS INCLUDED — on a session '
    + 'with no gate surface those gate to a DENY, and the agent will report that it cannot read '
    + 'its own channel';
  return scoped === 'unverified'
    ? `${label} has not been measured to show the gate a channel call's op and arguments, ${consequence}`
    : `${label} cannot show the gate a channel call's op and arguments, ${consequence}`;
}

// ── PROSE ────────────────────────────────────────────────────────────────────────────────────

/**
 * How a turn tells the agent to reach Dopl's deferred tools: `{ verb, catalog }`, or `null`. Null
 * when the entry is eager-loaded even though a verb exists (Claude's `alwaysLoad`), because ordering
 * the lookup there would order a denied call.
 */
function mcpDiscovery(d) {
  if (d && d.mcp && d.mcp.eagerLoadFlag) return null;
  const verb = (d && d.prose && d.prose.toolSearchVerb) || null;
  const catalog = (d && d.prose && d.prose.deferredCatalog) || null;
  return (verb || catalog) ? { verb, catalog } : null;
}

module.exports = {
  canResume, resumeRefusal, canSwitchModelLive,
  resumeZeroesBaseline, USAGE_BASELINE_RESETS, USAGE_BASELINE_CONTINUES,
  toolModes, narrowestToolMode, widestToolMode, normalizeToolMode, floorWindowlessTool,
  windowlessFloorRefusal, editScopedTools, toolTaxonomy, axisBOpScopedWarning, mcpDiscovery,
  // The launch-selection vocabulary (`selection-vocabulary.js`), re-exported for one require.
  pickRule: selection.pickRule,
  launchModelPick: selection.launchModelPick,
  nativeDimensions: selection.nativeDimensions,
  normalizeNative: selection.normalizeNative,
};
