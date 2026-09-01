/**
 * WHAT A RUNTIME DESCRIPTOR PERMITS THE UI TO RENDER — the web side's mirror of
 * `dopl-desktop-app/main/runtime/capability.js`, and the ONLY place on this side
 * a descriptor's `null` is interpreted.
 *
 * ⚠ PURE, AND THE ONLY PLACE `null` IS INTERPRETED — the rule is copied from the
 * main-process module verbatim because the reason is: the meaning of ABSENT is
 * not uniform. It HIDES a control almost everywhere and REFUSES an action in
 * three places (interrupt, resume, and a profile with no deny list). A component
 * that inlines `descriptor.session.interrupt == null` gets the common meaning and
 * is silently wrong at exactly the three that matter — and on this side "wrong"
 * means a Stop button that does nothing with no sentence saying why.
 *
 * ⚠ HIDE, NEVER GRAY (design §3.2). A capability a runtime lacks is ABSENT from
 * the UI — no disabled control, no placeholder, and no explanation of a mode
 * nobody can pick. The operator's mental model stays "this is what my runtime
 * does", not "this is Dopl pretending". A REFUSAL is the opposite and gets a
 * SENTENCE: {@link interruptRefusal}, {@link resumeRefusal},
 * {@link profileRefusal}. Never a greyed control with no reason.
 *
 * ⚠ NO HOOK, NO BRIDGE, NO REACT — the rule `permission-modes.ts` states and
 * `agent-models.ts` follows (INVARIANTS §1: one file, one reason to change).
 * Anything that reaches `window.dopl` belongs in a hook; anything that renders
 * belongs in a component. The ONE reason this file changes is that
 * `main/runtime/capability.js` changed.
 *
 * ⚠ IT IS NOT A SECOND AUTHORITY ON WHAT A RUNTIME CAN DO. Every predicate here
 * answers off the descriptor the desktop handed over, which `main/runtime/
 * contract.js › sealAdapter` deep-froze and refused to seal with a function in
 * it — so it survives the structured-clone hop and arrives as DATA. This module
 * decides nothing; it reads.
 *
 * ⚠ THE TYPES BELOW ARE A NARROWING, NOT THE DESCRIPTOR. The real object carries
 * the whole §1.2 shape (axisB, mcp, packaging, ambientFences, credential…); this
 * file types only the branches §3 renders, every one of them optional, because
 * the value crossed a process boundary from a build that may be older OR newer
 * than this bundle (INVARIANTS §11 — UNKNOWN is not EMPTY).
 */

/** Absent, in the descriptor's sense: `null`, `undefined`, or an omitted key.
 *  ⚠ NEVER `false` — `fork: false` is a runtime SAYING it cannot fork, which is
 *  a measurement, and `fork` missing is a descriptor that never mentioned it. */
export const absent = (v: unknown): boolean => v == null;

/** Declared-but-unmeasured. ⚠ A LEGAL VALUE, and a different answer from absent. */
export const unverified = (v: unknown): boolean => v === "unverified";

/** A tri-state descriptor field: measured true, measured false, or declared unmeasured. */
export type Verifiable = boolean | "unverified";

/** One member of an axis's vocabulary, in the PLATFORM's own words. */
export interface RuntimeModeOption {
  value: string;
  label: string;
  description?: string | null;
  native?: boolean;
}

/** The second select Codex and Cursor render and Claude does not (design §3.1). */
export interface RuntimeSecondaryAxis {
  key: string;
  label: string;
  options: ReadonlyArray<RuntimeModeOption>;
  default?: string | null;
}

/** Cursor's classifier instructions — `null` on all three adapters today.
 *  ⚠ `transport` MUST BE SHOWN, not hidden (§3.1): the documented home is a file
 *  Dopl would share with the operator and with the platform itself. */
export interface RuntimeFreeform {
  key: string;
  label: string;
  help?: string | null;
  allowKey?: string | null;
  blockKey?: string | null;
  transport?: string | null;
}

export interface RuntimeDescriptor {
  id: string;
  label: string;
  vendor?: string | null;
  entryFile?: string | null;
  session?: {
    resume?: Verifiable;
    fork?: Verifiable;
    steer?: Verifiable;
    interrupt?: Verifiable;
    liveModelSwitch?: Verifiable;
    usageResetsOnResume?: Verifiable;
  } | null;
  approval?: {
    granularity?: string | null;
    /** The platform's OWN category names, or `null`. No invented words. */
    categories?: ReadonlyArray<string> | null;
    sessionGrant?: Verifiable;
    hotSwapModes?: Verifiable;
  } | null;
  toolMode?: {
    /** ⚠ AN ORDERING. Index 0 is the fail-closed member; the LAST is the widest. */
    options?: ReadonlyArray<RuntimeModeOption> | null;
    default?: string | null;
    windowlessFloor?: string | null;
    secondaryAxis?: RuntimeSecondaryAxis | null;
    freeform?: RuntimeFreeform | null;
  } | null;
  containment?: {
    profiles?: Record<
      string,
      { denyList?: ReadonlyArray<string> | null } | null | undefined
    > | null;
  } | null;
  models?: { dimensions?: ReadonlyArray<string> | null } | null;
  meter?: {
    mode?: string | null;
    cost?: { currency?: string; billed?: boolean } | null;
  } | null;
  execution?: { locations?: ReadonlyArray<string> | null } | null;
  deepLink?: unknown;
}

/** ⚠ Module-level so an absent list is the SAME identity every render. */
const NO_OPTIONS: ReadonlyArray<RuntimeModeOption> = [];
const NO_CATEGORIES: ReadonlyArray<string> = [];

// ── THE REGISTRY, AS THE WIRE HANDS IT OVER ──────────────────────────────────

/**
 * DID THIS REPLY CARRY A RUNTIME FIELD AT ALL — the capability probe, and the
 * TWIN of `permission-modes.ts › hasModelKey` rather than a new idea.
 *
 * ⚠ IT IS AN OWN-KEY TEST, NOT A TRUTHINESS TEST, and the distinction is the
 * whole feature. `runtime: ''` is a current desktop saying "no pick, the DEFAULT
 * adapter applies"; NO KEY is a desktop that predates the runtime concept
 * entirely. A `!!raw.runtime` check collapses those into one answer and would
 * hide the row from every operator who had not yet chosen — INVARIANTS §11,
 * UNKNOWN is not EMPTY.
 *
 * ⚠ WHY A VALUE PROBE RATHER THAN A BRIDGE-MEMBER DETECTION, restated because it
 * is the same constraint the model hit: the runtime rides the EXISTING
 * `getLaunchPosture` / `setLaunchPosture` pair (`main/channel-dir-ipc.js` states
 * why it gets no op of its own), so there is no new member to feature-detect on.
 * ⚠ IT PROBES `runtime`, NOT `runtimes`. Both always ride the read together on a
 * build that has either, and the singular is the one whose ABSENCE is meaningful
 * on its own — an empty `runtimes` array is a legal answer from a build with the
 * concept and no adapters to offer.
 */
export function hasRuntimeKey(raw: unknown): boolean {
  return (
    !!raw &&
    typeof raw === "object" &&
    Object.prototype.hasOwnProperty.call(raw, "runtime")
  );
}

/**
 * Coerce a bridge reply's `runtimes` into a descriptor list. Anything that is
 * not an array of objects carrying a string `id` is dropped — a half-shaped
 * entry would render a row naming an adapter nothing can resolve.
 */
export function normalizeRuntimes(raw: unknown): RuntimeDescriptor[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (d): d is RuntimeDescriptor =>
      !!d &&
      typeof d === "object" &&
      typeof (d as RuntimeDescriptor).id === "string" &&
      !!(d as RuntimeDescriptor).id
  );
}

/**
 * Coerce an arbitrary value to a REGISTERED runtime id, or `''` for the default.
 *
 * ⚠ THE MIRROR OF `main/channel-runtime.js › normalizeRuntimeId`, AND THE ARITY
 * IS THE ONLY DIFFERENCE. Main validates against `runtime/index.js › ids()`, the
 * one enumeration of what that build ships; the web has no registry of its own
 * and must never grow one — the list is whatever THIS desktop just said it
 * registered, so it is a parameter. A hardcoded `['claude','codex','cursor']`
 * here would be a second authority that goes stale the day an adapter ships.
 *
 * ⚠ `''` IS THE ONLY SPELLING OF "NO PICK", so a channel that never chose and a
 * channel whose pick was cleared are one record — main's own rule, and what
 * keeps a reader from growing a third state to get wrong.
 */
export function normalizeRuntimeId(
  runtimes: ReadonlyArray<RuntimeDescriptor>,
  raw: unknown
): string {
  const id = typeof raw === "string" ? raw.trim() : "";
  if (!id) return "";
  return runtimes.some((d) => d.id === id) ? id : "";
}

/**
 * THE DESCRIPTOR A CHANNEL'S AGENTS WOULD LAUNCH ON — the pick if it resolves,
 * else the default adapter, else `null`.
 *
 * ⚠ IT FAILS TOWARD THE DEFAULT, NEVER TOWARD A REFUSAL, because main does: an
 * unknown stored id reads as `''` and `runtime/index.js › resolve` answers the
 * one adapter the build is certain it ships. Rendering nothing there would show
 * a channel with no vocabulary at all while its agents launch perfectly well.
 * ⚠ `null` MEANS "THIS BUILD OFFERED NO ADAPTERS" and every caller renders
 * nothing — the older-desktop case, and the plain browser.
 */
export function descriptorFor(
  runtimes: ReadonlyArray<RuntimeDescriptor>,
  id: unknown,
  defaultRuntime?: unknown
): RuntimeDescriptor | null {
  const picked = normalizeRuntimeId(runtimes, id);
  if (picked) return runtimes.find((d) => d.id === picked) ?? null;
  const fallback = normalizeRuntimeId(runtimes, defaultRuntime);
  if (fallback) return runtimes.find((d) => d.id === fallback) ?? null;
  return runtimes[0] ?? null;
}

// ── SESSION LIFECYCLE — TWO OF THE THREE REFUSALS ────────────────────────────

/**
 * ⚠ ONE THAT REFUSES RATHER THAN HIDING. An unverified resume-reset makes every
 * cost delta negative, clamps it to zero, and stops the cost cap ever firing —
 * with no error and no symptom until a bill arrives (design §1.4a). Cold launch
 * is unaffected, which is why the sentence names RESUME and not the runtime.
 */
export function canResume(d: RuntimeDescriptor | null | undefined): boolean {
  const s = d?.session ?? {};
  return s.resume === true && s.usageResetsOnResume === true;
}

/** Why a resume was refused, for the operator. `null` when it was not.
 *  ⚠ ONE SENTENCE, and it names no vendor — the descriptor's own label does that. */
export function resumeRefusal(
  d: RuntimeDescriptor | null | undefined
): string | null {
  const s = d?.session ?? {};
  if (s.resume !== true) return "This runtime cannot resume a conversation.";
  if (unverified(s.usageResetsOnResume)) {
    return "This runtime's usage accounting on resume is unverified, and a wrong answer stops the cost cap firing.";
  }
  return s.usageResetsOnResume === true
    ? null
    : "This runtime continues cumulative usage across a resume.";
}

/**
 * ⚠ WITHOUT AN INTERRUPT, DOPL CANNOT STOP A SESSION IT STARTED. Main's
 * `session-engine.js › runEffect` case `interruptQuery` is the tree's only
 * `.interrupt()`, so an unverified answer DISABLES the Stop control rather than
 * shipping a button that does nothing — and {@link interruptRefusal} is what
 * stops that being a control that vanished for no stated reason.
 */
export const canInterrupt = (d: RuntimeDescriptor | null | undefined): boolean =>
  d?.session?.interrupt === true;

/**
 * Why the Stop control is not offered, for the operator. `null` when it is.
 *
 * ⚠ IT IS THE TWIN OF {@link resumeRefusal}, NOT A NEW IDEA. A predicate that
 * answers only `false` produces a control that VANISHES with no reason, and
 * §3.2 asks for "the Stop control is disabled AND launch warns". A warning needs
 * a sentence, and a refusal an operator cannot read is one they work around.
 * ⚠ IT REFUSES A CONTROL, NOT A LAUNCH — main draws that boundary deliberately
 * (whether a runtime with no interrupt may SHIP is a release decision), and the
 * web must not tighten it into a launch block the desktop does not enforce.
 */
export function interruptRefusal(
  d: RuntimeDescriptor | null | undefined
): string | null {
  const s = d?.session ?? {};
  if (s.interrupt === true) return null;
  if (unverified(s.interrupt)) {
    return "This runtime's ability to stop a running turn is unverified, so Dopl cannot promise to stop a session it started.";
  }
  return "This runtime cannot stop a running turn.";
}

export const canSteer = (d: RuntimeDescriptor | null | undefined): boolean =>
  d?.session?.steer === true;

/** §3.2: absent ⇒ no "Fork" action. Codex is the only `true` today. */
export const canFork = (d: RuntimeDescriptor | null | undefined): boolean =>
  d?.session?.fork === true;

/** §3.2: absent ⇒ the live model picker is hidden on a RUNNING agent. */
export const canSwitchModelLive = (
  d: RuntimeDescriptor | null | undefined
): boolean => d?.session?.liveModelSwitch === true;

// ── THE METER ────────────────────────────────────────────────────────────────

/** `'per-message' | 'per-turn' | 'none'`. ⚠ `'none'` REMOVES the meter row; it
 *  never zeroes it — a zero is a measurement nobody took. */
export const meterMode = (d: RuntimeDescriptor | null | undefined): string =>
  d?.meter?.mode || "none";

/**
 * ⚠ HIDDEN, NOT ZEROED (§3.2, and it is bolded there). `main/session-state.js ›
 * costCapReached` is fed by exactly one number; a cap over a field the platform
 * does not emit is a control that silently does not exist. `null`-means-
 * unmeasured, applied to a control instead of to a number. Codex today.
 */
export const showsCostCap = (d: RuntimeDescriptor | null | undefined): boolean =>
  !absent(d?.meter?.cost);

/** §3.2: a BILLED cost line the other runtimes never show. Cursor today. */
export const showsBilledCost = (
  d: RuntimeDescriptor | null | undefined
): boolean => d?.meter?.cost?.billed === true;

// ── CONTAINMENT — THE THIRD REFUSAL ──────────────────────────────────────────

/**
 * May a session launch at this Dopl profile on this runtime?
 *
 * ⚠ THE ONE PLACE ABSENT DOES NOT MEAN HIDE (§3.2's last row, and main's
 * `grantDecision` step 1). A profile with no deny list in this runtime's tool
 * vocabulary has NO enforcement at all: a native sandbox bounds the filesystem,
 * it does not deny the delegation, exfil and persistence built-ins those lists
 * exist for. So the profile is REFUSED, with a reason.
 */
export function canLaunchProfile(
  d: RuntimeDescriptor | null | undefined,
  profile: string
): boolean {
  const entry = d?.containment?.profiles?.[profile];
  return !!entry && Array.isArray(entry.denyList);
}

/** Why a profile cannot launch on this runtime. `null` when it can. */
export function profileRefusal(
  d: RuntimeDescriptor | null | undefined,
  profile: string
): string | null {
  if (!d || canLaunchProfile(d, profile)) return null;
  return `${d.label || "This runtime"} declares no deny list for the "${profile}" profile, so that profile would not be enforced.`;
}

// ── AXIS A, AS DATA ──────────────────────────────────────────────────────────

/**
 * THIS RUNTIME'S AXIS-A VOCABULARY, IN ITS OWN WORDS AND ITS OWN ORDER.
 *
 * ⚠ THE ORDER IS LOAD-BEARING, NOT COSMETIC, and it is why this returns the
 * declared array rather than a sorted or relabelled one. `[0]` is the fail-closed
 * member every coercion lands on and the LAST entry is the widest mode — which is
 * how main's windowless floor stays widen-only. Rendering them in any other order
 * would teach the operator an ordering the gate does not hold: Codex's `granular`
 * sits SECOND (not last, as the design's §1.4 table predicted), because its five
 * categories are configured on Codex's side and Dopl cannot read them.
 * ⚠ EMPTY MEANS "NO DESCRIPTOR", and the caller falls back to Dopl's own
 * `permission-preset-row.tsx › TOOL_OPTIONS` — the older-desktop lane.
 */
export const toolModeOptions = (
  d: RuntimeDescriptor | null | undefined
): ReadonlyArray<RuntimeModeOption> => d?.toolMode?.options ?? NO_OPTIONS;

/** Just the values, narrowest FIRST. */
export const toolModes = (
  d: RuntimeDescriptor | null | undefined
): string[] => toolModeOptions(d).map((o) => o.value);

/** The narrowest mode — where every unknown value fail-closes. */
export const narrowestToolMode = (
  d: RuntimeDescriptor | null | undefined
): string | null => toolModes(d)[0] ?? null;

/** The widest mode this runtime offers. ⚠ Still bounded by hard-deny and by the
 *  channel's tool profile, neither of which any mode opens. */
export function widestToolMode(
  d: RuntimeDescriptor | null | undefined
): string | null {
  const modes = toolModes(d);
  return modes.length ? modes[modes.length - 1] : null;
}

/**
 * Fail-closed coercion of a stored Axis-A mode into THIS runtime's vocabulary.
 *
 * ⚠ IT IS WHY THE PERMISSIONS ROW CANNOT JUST RENDER `posture.tools`. The stored
 * pair is Claude-shaped (`manual` / `accept_edits` / `auto` / `bypass`) on every
 * channel written before a runtime was picked, and `manual` is not a word Codex
 * or Cursor speaks. Showing it would name a mode the runtime will never be asked
 * for; coercing to the NARROWEST is what main does with the same value.
 */
export function normalizeToolMode(
  d: RuntimeDescriptor | null | undefined,
  mode: unknown
): string | null {
  const modes = toolModes(d);
  if (!modes.length) return null;
  return modes.indexOf(String(mode)) === -1 ? modes[0] : String(mode);
}

/**
 * The SECOND select — Codex's `sandbox_mode`, Cursor's `sandbox`.
 * ⚠ `null` ON CLAUDE, AND THAT RENDERS NOTHING: no placeholder, no disabled row,
 * and no sentence explaining a sandbox Claude does not have (§3.1, §3.2).
 */
export const secondaryAxis = (
  d: RuntimeDescriptor | null | undefined
): RuntimeSecondaryAxis | null => d?.toolMode?.secondaryAxis ?? null;

/**
 * The platform's OWN approval category names, or empty.
 *
 * ⚠ NO INVENTED WORDS, EVER (design §1.4's "on the approval vocabulary
 * generally"): revision 1 of the design declared `['command','file-change',
 * 'network','mcp']`, none of which appear in Codex's documentation. Inventing
 * category names inside the mechanism whose purpose is to enforce native
 * vocabulary is the exact failure the descriptor exists to prevent. The five
 * below come off the wire and are rendered verbatim.
 */
export const approvalCategories = (
  d: RuntimeDescriptor | null | undefined
): ReadonlyArray<string> => d?.approval?.categories ?? NO_CATEGORIES;

/** Which Axis-A mode the categories hang under, or `null` when there are none.
 *  ⚠ `'category'` GRANULARITY IS THE GATE, not the mode's name: the sub-control
 *  belongs to whichever option the platform's category granularity applies to. */
export const approvalGranularity = (
  d: RuntimeDescriptor | null | undefined
): string | null => d?.approval?.granularity ?? null;

/**
 * WHICH AXIS-A OPTION THE APPROVAL CATEGORIES HANG UNDER — `null` when none do.
 *
 * ⚠ THE ONE JOIN §3.1 STATES IN PROSE THAT THE DESCRIPTOR DOES NOT CARRY, AND
 * THAT IS RECORDED DEBT (F-391), not a licence. The design says the five
 * categories render "under Codex's `granular` option only"; the descriptor
 * declares `approval.granularity: 'category'` and `approval.categories`, and
 * nothing joins either to a member of `toolMode.options`. So the join is made
 * here, once, gated on BOTH declarations — a runtime that does not claim
 * category granularity, or that offers no option by that name, gets no
 * sub-control rather than a guess.
 * ⚠ THE VENDOR WORD IS A LOOKUP, NEVER A LABEL. `GRANULAR_MODE` is matched
 * against the runtime's OWN option values and the matched option's own `label`
 * is what renders — so a platform that spells it differently simply gets no
 * sub-control, which is the fail-closed direction. The fix is a descriptor
 * field (`approval.categoryMode`), and it belongs to main.
 */
const CATEGORY_GRANULARITY = "category";
const GRANULAR_MODE = "granular";

export function approvalCategoryMode(
  d: RuntimeDescriptor | null | undefined
): string | null {
  if (approvalGranularity(d) !== CATEGORY_GRANULARITY) return null;
  if (!approvalCategories(d).length) return null;
  const named = toolModeOptions(d).find((o) => o.value === GRANULAR_MODE);
  return named ? named.value : null;
}

/** §3.2: absent ⇒ no "allow for the rest of this session" affordance. */
export const showsSessionGrant = (
  d: RuntimeDescriptor | null | undefined
): boolean => d?.approval?.sessionGrant === true;

/** §3.2: `'unverified'` ⇒ a mode change needs a restart; no live-swap affordance. */
export const canHotSwapModes = (
  d: RuntimeDescriptor | null | undefined
): boolean => d?.approval?.hotSwapModes === true;

/**
 * Cursor's classifier instructions — `null` on all three adapters TODAY.
 *
 * ⚠ THE BRANCH IS WRITTEN ANYWAY, AND ON PURPOSE. §3.1 asks for it, and the
 * shape it asks for is unusual enough that discovering it at ship time is how it
 * gets built wrong: `transport` must be SHOWN, not hidden, because the
 * documented home is a file Dopl would share with the operator and with the
 * platform itself. A data-driven branch that renders nothing today renders the
 * right thing the day a descriptor fills it in.
 */
export const freeform = (
  d: RuntimeDescriptor | null | undefined
): RuntimeFreeform | null => d?.toolMode?.freeform ?? null;

// ── MODELS, EXECUTION, LINKS ─────────────────────────────────────────────────

/**
 * §3.2: `models.dimensions` absent ⇒ NO reasoning-effort control (Claude,
 * Cursor). Codex is the only `['reasoningEffort']` today.
 * ⚠ THE DIMENSION IS NAMED, not merely counted: a future descriptor listing some
 * other dimension must not light up a reasoning-effort row by arity.
 */
export const hasReasoningEffort = (
  d: RuntimeDescriptor | null | undefined
): boolean => (d?.models?.dimensions ?? []).indexOf("reasoningEffort") !== -1;

/** §3.2: one location ⇒ NO location picker. All three are `['local']` today. */
export const showsLocationPicker = (
  d: RuntimeDescriptor | null | undefined
): boolean => (d?.execution?.locations ?? []).length > 1;

/** §3.2: `deepLink: null` ⇒ no "Open in …" button. `null` on all three today. */
export const hasDeepLink = (
  d: RuntimeDescriptor | null | undefined
): boolean => !absent(d?.deepLink);
