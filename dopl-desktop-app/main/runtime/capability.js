// CAPABILITY PREDICATES — the questions core and the IPC bridge ask a descriptor.
//
// ⚠ PURE, AND THE ONLY PLACE `null` IS INTERPRETED. Every consumer asks here rather than reading
// `descriptor.x.y == null` for itself, because the meaning of absent is NOT uniform: it hides a
// control almost everywhere and REFUSES an action in three places (`contract.js ›
// LAUNCH_BLOCKING`). A call site that inlines the null check gets the common meaning and is
// silently wrong at exactly the three that matter.
//
// ⚠ HIDE, NEVER GRAY. A capability a runtime lacks is absent from the UI — no disabled control,
// no placeholder, no explanation of a mode nobody can pick. The operator's mental model stays
// "this is what my runtime does", not "this is Dopl pretending".

// ⚠ ONE REQUIRE, AND IT IS A CONSTANT RATHER THAN BEHAVIOUR. `contract.js` requires nothing at
// all, so this cannot cycle; the value is the one profile whose supervision is a MODE rather than
// a list, which both files need and neither may restate (D2).
const { UNRESTRICTED_PROFILE } = require('./contract');
// ⚠ **THE LAUNCH-SELECTION VOCABULARY MOVED TO `main/runtime/selection-vocabulary.js` ON
// 2026-09-21 (U5)**, at the §1 cap and on a real seam: that file changes when the shape of a
// DURABLE LAUNCH SELECTION changes (which model vocabularies exist, which native dimensions an
// adapter may declare and spend), where the rest of this file changes when the meaning of an
// ABSENT capability does. Re-exported below, so no caller moved. It requires nothing but this
// module's own sibling constants, so it cannot cycle either.
const selection = require('./selection-vocabulary');

/** Absent, in the descriptor's sense: `null`, `undefined`, or an omitted key. Never `false`. */
const absent = (v) => v == null;

/** Declared-but-unmeasured. ⚠ A LEGAL VALUE, and a different answer from absent. */
const unverified = (v) => v === 'unverified';

// ── SESSION LIFECYCLE ────────────────────────────────────────────────────────────────────────

// ── THE RESUME USAGE BASELINE ────────────────────────────────────────────────────────────────
//
// ⚠ TWO MEASURED ANSWERS AND ONE ABSENCE, AND ONLY THE ABSENCE REFUSES (2026-09-22, CXP-4). This
// used to read `usageResetsOnResume === true` as the ONLY resumable answer, which made a MEASURED
// `false` disqualifying — and the harm it was protecting against was never the declaration, it was
// `session-park.js › resumeParked` ZEROING the delta baseline unconditionally. Against a runtime
// whose totals continue, that reset re-bills the whole thread on the first post-resume `result`.
// The baseline is runtime-aware now (`resumeZeroesBaseline` below is the one statement of it), so
// `false` stops being disqualifying while the MEASUREMENT it records does not move.
// ⚠ WHAT STILL REFUSES IS `'unverified'` — and absence, which reads the same way. An unmeasured
// runtime cannot be given either treatment: zero it and a continuing runtime re-bills its history,
// preserve it and a resetting runtime under-counts every post-resume turn to zero through
// `session-io.js › applyCoreEvents`'s `Math.max(0, …)` clamp. UNKNOWN IS NOT EMPTY (INVARIANTS
// §11): neither branch is safe, so the resume does not happen.

/** Declared in either direction, i.e. somebody measured it. ⚠ `'unverified'` and absent are not. */
const usageBaselineMeasured = (d) => d.usageResetsOnResume === true || d.usageResetsOnResume === false;

/**
 * ⚠ THE ONE THAT REFUSES RATHER THAN HIDING (`contract.js › LAUNCH_BLOCKING`). An unverified
 * resume-reset leaves core with no safe way to carry the cost/token delta baseline across the
 * resume — one direction re-bills history the operator already paid for, the other silently
 * counts every later turn as zero. Cold launch is unaffected.
 */
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

// ⚠ A SECOND COPY OF `main/session-runtime-truth.js`'s TWO MEASURED WORDS, and it is the same
// deliberate duplication `session-park.js › KNOWN_PROFILES` carries for the same class of reason:
// that module is CORE (it owns what a durable record may say) and this one is the RUNTIME layer,
// which may not depend on core. HELD EQUAL BY A TEST rather than by discipline —
// `test/session-runtime-truth.test.mjs` asserts both spellings match — because a word that drifts
// here does not fail loudly: it falls through to the descriptor, which is exactly the
// re-interpretation the record was persisted to prevent.
const USAGE_BASELINE_RESETS = 'resets';
const USAGE_BASELINE_CONTINUES = 'continues';

/**
 * MUST A RESUME ZERO THE CUMULATIVE-USAGE DELTA BASELINE, or carry it forward?
 *
 * ⚠ THE RECORD'S OWN ANSWER WINS OVER TODAY'S DESCRIPTOR, WHICH IS WHY IT WAS PERSISTED.
 * `recorded` is `session-runtime-truth.js › usageBaseline`'s word off a durable session record. A
 * build that later flips an adapter's `usageResetsOnResume` must not re-interpret a conversation
 * that already happened under the old answer — that would be claiming a measurement nobody took
 * about work that is already billed. A record states what was true when it was written.
 * ⚠ `'unverified'` AND ABSENT FALL THROUGH TO THE DESCRIPTOR, and that is not a weakening: a
 * record that states no measurement has said nothing to honour, and EVERY record written before
 * this field existed reads that way — deciding those off the record would refuse or mis-bill every
 * pre-U10 Claude session on the operator's disk. The descriptor is what `resumeRefusal` gates on
 * anyway, so a runtime with no measurement never reaches this function at all.
 * ⚠ FAIL-SAFE DIRECTION: only a MEASURED `true` zeroes. Anything else preserves, because the two
 * errors are not symmetric — preserving against a resetting runtime under-counts (clamped to zero
 * by `session-io.js`), while zeroing against a continuing one RE-BILLS THE ENTIRE THREAD.
 */
function resumeZeroesBaseline(descriptor, recorded) {
  if (recorded === USAGE_BASELINE_RESETS) return true;
  if (recorded === USAGE_BASELINE_CONTINUES) return false;
  return ((descriptor && descriptor.session) || {}).usageResetsOnResume === true;
}

/**
 * ⚠ WITHOUT AN INTERRUPT, DOPL CANNOT STOP A SESSION IT STARTED. `session-engine.js › runEffect`
 * case `interruptQuery` is the tree's only `.interrupt()`, and the reducer's `interrupt` and
 * `abandon_timeout` effects have no other actuator — so an unverified answer disables the Stop
 * control rather than shipping a button that does nothing.
 */
const canInterrupt = (d) => !!(d && d.session && d.session.interrupt === true);

/**
 * Why the Stop control is not offered, for the operator. `null` when it is.
 *
 * ⚠ ADDED 2026-08-31 (port step 8), AND IT IS THE TWIN OF `resumeRefusal` RATHER THAN A NEW IDEA.
 * The rule was already here — `canInterrupt` reads anything but `true` as false — but a predicate
 * that answers only `false` produces a control that VANISHES with no reason, and §3.2 asks for
 * "the Stop control is disabled AND LAUNCH WARNS". A warning needs a sentence, and a refusal an
 * operator cannot read is one they work around. So the sentence lives with the predicate, in the
 * one module that is allowed to interpret `null`, and names no vendor.
 * ⚠ IT REFUSES A CONTROL, NOT A LAUNCH, and that boundary is deliberate: whether a runtime with no
 * interrupt may SHIP is a release decision, not a per-session one, and encoding it here as a
 * launch refusal would put a ship gate somewhere nobody would look for it.
 */
function interruptRefusal(descriptor) {
  const d = (descriptor && descriptor.session) || {};
  if (d.interrupt === true) return null;
  if (unverified(d.interrupt)) {
    return 'this runtime\'s ability to stop a running turn is unverified, so Dopl cannot promise to stop a session it started';
  }
  return 'this runtime cannot stop a running turn';
}

const canSteer = (d) => !!(d && d.session && d.session.steer === true);
const canFork = (d) => !!(d && d.session && d.session.fork === true);
const canSwitchModelLive = (d) => !!(d && d.session && d.session.liveModelSwitch === true);

// ── THE METER ────────────────────────────────────────────────────────────────────────────────

/** `'per-message' | 'per-turn' | 'none'`. `'none'` removes the meter row; it never zeroes it. */
const meterMode = (d) => (d && d.meter && d.meter.mode) || 'none';

// 🔒 ⚠ **`showsCostCap` IS DELETED (2026-09-22, Samuel: *"we dont need cost tracking"*).** It
// asked whether `descriptor.meter.cost` was present so a caller could hide a cost control on a
// runtime that reports none — and it HAD NO CALLER, in either tree, from the day it was written.
// The column it guarded is gone with it: `meter.cost` on all three adapters, `state.costUsd`, the
// durable record's field, both cost delta baselines and `events.result`'s cost argument.
// ⚠ WHAT REMAINS IS `meterMode`, WHICH IS A DIFFERENT QUESTION and also currently unconsumed:
// that one says whether a runtime meters per MESSAGE or per TURN, which is about TOKENS — and
// tokens are displayed on three surfaces.

// ── CONTAINMENT ──────────────────────────────────────────────────────────────────────────────

/**
 * May a session launch at this Dopl profile on this runtime?
 *
 * ⚠ THE ONE PLACE ABSENT DOES NOT MEAN HIDE. `grantDecision` step 1 reads the profile's deny list
 * as the gate's own first check — the verdict no task grant and no `bypass` can open. A profile
 * with no deny list in this runtime's tool vocabulary has NO enforcement at all: a native sandbox
 * bounds the filesystem, it does not deny the delegation, exfil and persistence built-ins those
 * lists exist for. So the profile is REFUSED at launch, with a reason.
 *
 * ⚠ AND AN EMPTY LIST IS REFUSED TOO, ON EVERY PROFILE BUT `full` (2026-09-01, D2). This asked
 * only `Array.isArray`, and `[]` is an array — so `denyList: []`, which SAYS "this profile denies
 * nothing", answered the same as a real list. That is the identical condition `null` is refused
 * for: the gate's first check with nothing to check. `full` is exempt because its supervision IS
 * Axis A rather than a list, so an empty floor there is a posture somebody chose. The same rule is
 * enforced one step earlier, at registration, by `contract.js › descriptorProblems`.
 */
function canLaunchProfile(descriptor, profile) {
  const profiles = (descriptor && descriptor.containment && descriptor.containment.profiles) || {};
  const entry = profiles[profile];
  if (!entry || !Array.isArray(entry.denyList)) return false;
  return entry.denyList.length > 0 || profile === UNRESTRICTED_PROFILE;
}

function profileRefusal(descriptor, profile) {
  if (canLaunchProfile(descriptor, profile)) return null;
  const label = (descriptor && descriptor.label) || 'this runtime';
  const profiles = (descriptor && descriptor.containment && descriptor.containment.profiles) || {};
  const entry = profiles[profile];
  if (entry && Array.isArray(entry.denyList) && entry.denyList.length === 0) {
    return `${label} denies nothing at the "${profile}" profile, so that profile would not be enforced`;
  }
  return `${label} declares no deny list for the "${profile}" profile, so that profile would not be enforced`;
}

// ── AXIS A + AXIS B ──────────────────────────────────────────────────────────────────────────

/**
 * The mode an UNATTENDED session floors to on this runtime.
 *
 * ⚠ PER RUNTIME, BECAUSE A MODE THAT FAIL-CLOSES TO A VOCABULARY THE RUNTIME DOES NOT SPEAK
 * DENIES EVERYTHING. A windowless session has no gate surface — `session-windowless.js ›
 * claimGate` answers a permission request with a deny — so an unrecognised mode resolves to the
 * most restrictive member, which allows no tool, which on a windowless session is a silent deny
 * of every read the prompt ORDERS the agent to make. `null` refuses the windowless launch instead.
 */
const windowlessToolFloorValue = (d) => (d && d.toolMode && d.toolMode.windowlessFloor) || null;

/**
 * This runtime's Axis-A mode vocabulary, narrowest FIRST.
 *
 * ⚠ THE ORDER IS LOAD-BEARING, NOT COSMETIC. `[0]` is the fail-closed member every coercion lands
 * on, and the LAST entry is the widest mode — which is how `floorWindowlessTool` can be
 * widen-only and how "is this tool classified at all" can be asked without core holding a copy of
 * any allow-list. An adapter that lists its modes in any other order breaks both.
 */
const toolModes = (d) => ((d && d.toolMode && d.toolMode.options) || []).map((o) => o.value);

/** The narrowest mode — where every unknown value fail-closes. */
const narrowestToolMode = (d) => toolModes(d)[0] || null;

/** The widest mode this runtime offers. ⚠ Still bounded by hard-deny, which no mode opens. */
function widestToolMode(d) {
  const modes = toolModes(d);
  return modes.length ? modes[modes.length - 1] : null;
}

/** Fail-closed coercion of a stored Axis-A mode. Anything unrecognised is the narrowest. */
function normalizeToolMode(d, mode) {
  const modes = toolModes(d);
  return modes.indexOf(mode) === -1 ? (modes[0] || null) : mode;
}

/**
 * Axis A's windowless floor, expressed as data rather than as a per-runtime transform.
 *
 * ⚠ WIDEN-ONLY, AND THAT IS WHY IT IS AN INDEX COMPARISON. A session already at or above the
 * floor keeps its mode; one below it is raised. NARROWING would be the opposite of the ruling
 * this floor came from: the floor exists because a windowless session has no gate surface, so a
 * gated tool there is a silent DENY of reads the prompt ORDERS the agent to make. It never opens
 * anything the PROFILE did not already permit — hard-deny and the profile's own deny list are
 * both checked before Axis A.
 * ⚠ `windowlessFloor: null` REFUSES THE WINDOWLESS LAUNCH rather than picking a mode. A floor
 * guessed on a runtime whose modes we cannot order is a posture nobody chose.
 *
 * ⚠ AND IT NOW ACTUALLY REFUSES (2026-09-01, D1). The rule above was written into this comment
 * and never into the code: the guard read `if (target === -1) return normalizeToolMode(d, mode)`,
 * which hands back the session's OWN stored mode un-floored — and Axis A's stored mode starts at
 * the narrowest member and RESETS to it on park, while an unrecognised one fail-closes there too.
 * So the "refusal" silently produced exactly the harm two paragraphs up: the narrowest mode on a
 * session with NO GATE SURFACE, where every gated call is a silent deny of reads the prompt
 * ORDERS the agent to make. Answering `null` is what makes the refusal reachable — the sentence
 * is `windowlessFloorRefusal` below and the launch that reads it is `session-launch.js`.
 * ⚠ BOTH CAUSES REFUSE, and they are one cause. `floor === null` is the honest declaration; a
 * floor NAMED but absent from `toolMode.options` is an adapter whose own modes do not contain the
 * one it floors to. Neither is orderable, and picking for either is the guess this refuses.
 * ⚠ `null` IS THE ANSWER, NOT A THROW. Callers are gate-adjacent — `session-io.js › grantArgs`
 * runs per tool call — and a throw there would surface as a query crash rather than as a launch
 * that never happened. A `null` mode fails closed at `axisAAllows` for free.
 */
function floorWindowlessTool(d, mode) {
  const floor = windowlessToolFloorValue(d);
  const modes = toolModes(d);
  const at = modes.indexOf(normalizeToolMode(d, mode));
  const target = modes.indexOf(floor);
  if (target === -1) return null; // no orderable floor: REFUSE, never pick (D1)
  return at > target ? modes[at] : floor;
}

/**
 * Why a WINDOWLESS launch is refused on this runtime, for the operator. `null` when it is not.
 *
 * ⚠ THE TWIN OF `resumeRefusal` / `interruptRefusal` / `profileRefusal`, AND IT REFUSES A LAUNCH
 * (`contract.js › LAUNCH_BLOCKING`), not a control. That boundary is the opposite of
 * `interruptRefusal`'s and for the opposite reason: a missing Stop button is visible to the
 * operator the moment they look for it, while a missing tool floor is invisible — the session
 * launches, runs, and silently denies its own reads until someone reads the transcript.
 * ⚠ WINDOWLESS ONLY. A runtime with no floor is perfectly launchable WITH a gate surface; this
 * tree ships no windowed session, but the refusal is still scoped to the shape that needs it
 * rather than taking the whole adapter off the table (the `denyList` precedent, `contract.js`).
 * ⚠ NAMES NO VENDOR: the label is the descriptor's own.
 */
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

/**
 * The tool names whose grant key is scoped to a resolved DIRECTORY rather than to a digest of the
 * whole input (`main/session-grant-keys.js › makeGrantKeyFor`). Per-runtime because it is a list
 * of that runtime's file-writing built-ins.
 */
const editScopedTools = (d) => ((d && d.toolMode && d.toolMode.editScopedTools) || []).slice();

/**
 * This runtime's Axis-A tool taxonomy, as declared data. ⚠ READ-ONLY AND FOR PINNING/RENDERING —
 * a gate decision asks `axisAAllows`, never a membership test against one of these lists, because
 * only the runtime knows how its modes compose them.
 */
function toolTaxonomy(d) {
  const t = (d && d.toolMode && d.toolMode.taxonomy) || {};
  const copy = (v) => (Array.isArray(v) ? v.slice() : []);
  return {
    auto: copy(t.auto), bypass: copy(t.bypass), bypassReads: copy(t.bypassReads),
    edits: copy(t.edits), escalation: copy(t.escalation),
  };
}

/** `'held-callback' | 'in-process'`. Never `null` on a registered adapter (`contract.js`). */
const axisBEnforcement = (d) => (d && d.axisB && d.axisB.enforcementPoint) || null;

/**
 * Can the Axis-B gate see `input.op` / `input.channel` / `to` / `kind`?
 *
 * ⚠ `false` COLLAPSES AXIS B FROM OP-SCOPED TO WHOLE-TOOL — every channel call gates, READS
 * INCLUDED — and a held inbound on a windowless session is held forever, which is the exact
 * failure `session-profiles.js › floorWindowlessMessage` exists to prevent.
 */
const axisBOpScoped = (d) => !!(d && d.axisB && d.axisB.opScoped === true);

/**
 * The WARNING a launch carries when this runtime's Axis B is not op-scoped. `null` when it is.
 *
 * ⚠ WRITTEN 2026-09-01 (D3) BECAUSE `axisBOpScoped` HAD ZERO CONSUMERS. The predicate above was
 * declared, documented in the strongest terms, read by nothing anywhere in `main/` or `src/`, and
 * therefore could not do the one job a declaration has: telling the operator. A declared
 * limitation with a documented severe consequence and no consumer is a comment, not a contract.
 *
 * ⚠ A WARNING AND NOT A REFUSAL, AND THE DIRECTION OF FAILURE IS THE WHOLE ARGUMENT. Traced end to
 * end: with input the gate cannot read, `session-profiles.js › grantDecision`'s Axis-B branch fails
 * `postFieldsOk` and answers `'gate'`, and a windowless session's `session-windowless.js ›
 * claimGate` answers a gate with a DENY. So Axis B on such a runtime is OVER-restrictive, never
 * open: the agent is broken, the gate is not. Refusing the launch would take a registered adapter
 * off the only spawn shape this tree has over a failure that cannot leak anything — that is a ship
 * decision, not a per-session one, and it is the same boundary `interruptRefusal` draws.
 * ⚠ AND `floorWindowlessMessage` CANNOT COMPENSATE, which is why the warning is worth carrying: it
 * is a core transform over the message enum and never consults `opScoped`, and the auto-allow lanes
 * it feeds all need readable input to match on. The floor raises the POSTURE; it cannot make an
 * unreadable call readable.
 * ⚠ `'unverified'` AND `false` GET THE SAME SENTENCE ON PURPOSE — the harm is identical and the
 * operator cannot act on the difference — but they are worded apart so the log says which it was.
 */
function axisBOpScopedWarning(descriptor) {
  const scoped = descriptor && descriptor.axisB && descriptor.axisB.opScoped;
  if (scoped === true) return null;
  const label = (descriptor && descriptor.label) || 'this runtime';
  const consequence = 'so every channel call gates as a whole tool, READS INCLUDED — on a session '
    + 'with no gate surface those gate to a DENY, and the agent will report that it cannot read '
    + 'its own channel';
  return unverified(scoped)
    ? `${label} has not been measured to show the gate a channel call's op and arguments, ${consequence}`
    : `${label} cannot show the gate a channel call's op and arguments, ${consequence}`;
}

/**
 * How the forced thread tag is applied. ⚠ `null` IS NOT A LEGAL ANSWER for a shipped adapter:
 * without the stamp, agents stop self-filtering their own posts in a shared channel, which is a
 * fan-out/echo failure and not a cosmetic one (`main/session-outbound-tag.js`'s header records
 * the incident). Declared here so the refusal is readable rather than discovered in a channel.
 */
const inputRewrite = (d) => (d && d.axisB && d.axisB.inputRewrite) || null;

// ── PROSE + MISC ─────────────────────────────────────────────────────────────────────────────

const toolSearchVerb = (d) => (d && d.prose && d.prose.toolSearchVerb) || null;
// CXP-3A (2026-09-22): the verb a turn must tell the agent to load DOPL'S tools with, or `null`.
// ⚠ `null` WHEN THE ENTRY IS EAGER-LOADED even though a verb exists: Claude has `ToolSearch` but
// Dopl's entry carries `alwaysLoad`, so ordering the lookup there would order a denied call.
const mcpDiscoveryVerb = (d) => ((d && d.mcp && d.mcp.eagerLoadFlag) ? null : toolSearchVerb(d));
const entryFile = (d) => (d && d.entryFile) || null;
const hasDeepLink = (d) => !absent(d && d.deepLink);
const hasInteractiveSignIn = (d) => !absent(d && d.credential && d.credential.interactiveSignIn);
const showsLocationPicker = (d) => {
  const locations = (d && d.execution && d.execution.locations) || [];
  return locations.length > 1;
};

module.exports = {
  absent, unverified,
  canResume, resumeRefusal, canInterrupt, interruptRefusal, canSteer, canFork, canSwitchModelLive,
  // CXP-4 (2026-09-22): the baseline rule BOTH record-driven rebuilds and the in-place resume ask.
  // The two words are exported so the suite can hold them equal to `session-runtime-truth.js`'s.
  resumeZeroesBaseline, USAGE_BASELINE_RESETS, USAGE_BASELINE_CONTINUES,
  meterMode,
  canLaunchProfile, profileRefusal,
  toolModes, narrowestToolMode, widestToolMode, normalizeToolMode, floorWindowlessTool,
  windowlessFloorRefusal, // D1: the sentence behind `floorWindowlessTool`'s `null`
  editScopedTools, toolTaxonomy,
  // U5 (2026-09-21): RE-EXPORTED from `selection-vocabulary.js` (§1 cap), which carries why the
  // launch-selection vocabulary is a different reason to change from what `null` means to a
  // control. No caller moved.
  pickRule: selection.pickRule,
  storeModelPick: selection.storeModelPick,
  launchModelPick: selection.launchModelPick,
  nativeDimensions: selection.nativeDimensions,
  normalizeNative: selection.normalizeNative,
  windowlessToolFloor: windowlessToolFloorValue, axisBEnforcement, axisBOpScoped, inputRewrite,
  axisBOpScopedWarning, // D3: `axisBOpScoped`'s consumer — the sentence a launch carries
  toolSearchVerb, mcpDiscoveryVerb, entryFile, hasDeepLink, hasInteractiveSignIn, showsLocationPicker,
};
