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

/** Absent, in the descriptor's sense: `null`, `undefined`, or an omitted key. Never `false`. */
const absent = (v) => v == null;

/** Declared-but-unmeasured. ⚠ A LEGAL VALUE, and a different answer from absent. */
const unverified = (v) => v === 'unverified';

// ── SESSION LIFECYCLE ────────────────────────────────────────────────────────────────────────

/**
 * ⚠ THE ONE THAT REFUSES RATHER THAN HIDING (`contract.js › LAUNCH_BLOCKING`). An unverified
 * resume-reset makes every cost delta negative, clamps it to zero, and stops the cost cap ever
 * firing — with no error and no symptom until a bill arrives. Cold launch is unaffected.
 */
function canResume(descriptor) {
  const d = (descriptor && descriptor.session) || {};
  return d.resume === true && d.usageResetsOnResume === true;
}

/** Why a resume was refused, for the operator. `null` when it was not. */
function resumeRefusal(descriptor) {
  const d = (descriptor && descriptor.session) || {};
  if (d.resume !== true) return 'this runtime cannot resume a conversation';
  if (unverified(d.usageResetsOnResume)) {
    return 'this runtime\'s usage accounting on resume is unverified, and a wrong answer stops the cost cap firing';
  }
  return d.usageResetsOnResume === true ? null : 'this runtime continues cumulative usage across a resume';
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

/**
 * ⚠ HIDDEN, NOT ZEROED. `main/session-state.js › costCapReached` is fed by exactly one number;
 * a cap over a field the platform does not emit is a control that silently does not exist. The
 * `null`-means-unmeasured rule, applied to a control instead of a number.
 */
const showsCostCap = (d) => !absent(d && d.meter && d.meter.cost);

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
  meterMode, showsCostCap,
  canLaunchProfile, profileRefusal,
  toolModes, narrowestToolMode, widestToolMode, normalizeToolMode, floorWindowlessTool,
  windowlessFloorRefusal, // D1: the sentence behind `floorWindowlessTool`'s `null`
  editScopedTools, toolTaxonomy,
  windowlessToolFloor: windowlessToolFloorValue, axisBEnforcement, axisBOpScoped, inputRewrite,
  axisBOpScopedWarning, // D3: `axisBOpScoped`'s consumer — the sentence a launch carries
  toolSearchVerb, entryFile, hasDeepLink, hasInteractiveSignIn, showsLocationPicker,
};
