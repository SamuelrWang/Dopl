/**
 * What a runtime descriptor lets the UI render — the one place on the web a descriptor's `null` is
 * interpreted (`main/runtime/capability.js` is the desktop half). Absent HIDES a control (never
 * gray); interrupt is the one absence that REFUSES, with a sentence.
 * The types narrow the descriptor to the branches rendered here; every branch is optional.
 */

/** A tri-state field: measured true, measured false, or declared unmeasured. */
type Verifiable = boolean | "unverified";

const unverified = (v: unknown): boolean => v === "unverified";

/** One member of an axis's vocabulary, in the platform's own words. */
export interface RuntimeModeOption {
  value: string;
  label: string;
  description?: string | null;
  native?: boolean;
}

/** The second select Codex and Cursor render and Claude does not. */
export interface RuntimeSecondaryAxis {
  key: string;
  label: string;
  options: ReadonlyArray<RuntimeModeOption>;
  default?: string | null;
}

/** Cursor's classifier instructions. ⚠ `transport` must be SHOWN: its home is a file Dopl shares. */
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
  session?: {
    interrupt?: Verifiable;
    liveModelSwitch?: Verifiable;
  } | null;
  approval?: {
    granularity?: string | null;
    /** The platform's OWN category names, or `null`. No invented words. */
    categories?: ReadonlyArray<string> | null;
  } | null;
  toolMode?: {
    /** ⚠ AN ORDERING. Index 0 is the fail-closed member; the LAST is the widest. */
    options?: ReadonlyArray<RuntimeModeOption> | null;
    default?: string | null;
    secondaryAxis?: RuntimeSecondaryAxis | null;
    freeform?: RuntimeFreeform | null;
  } | null;
  /** `interactiveSignIn` is true only where Dopl can drive the sign-in in its own window. */
  credential?: { interactiveSignIn?: Verifiable | null } | null;
  /** A declaration about the runtime, never the roster (models live in `model-catalog.ts`). */
  models?: { dimensions?: ReadonlyArray<string> | null } | null;
}

/** ⚠ Module-level so an absent list is the SAME identity every render. */
const NO_OPTIONS: ReadonlyArray<RuntimeModeOption> = [];
const NO_CATEGORIES: ReadonlyArray<string> = [];

/** A bridge reply's `runtimes` as descriptors; an entry without a string `id` is dropped. */
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
 * A registered runtime id, or `''` for the default (`main/channel-runtime.js › normalizeRuntimeId`).
 * ⚠ `''` is the only spelling of "no pick". The list is what this desktop reported, never a
 * hardcoded roster.
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
 * The descriptor a launch would use: the pick if registered, else the reported default (main
 * resolves an unknown stored id to the default too). `null` = no adapters or no reported default.
 */
export function descriptorFor(
  runtimes: ReadonlyArray<RuntimeDescriptor>,
  id: unknown,
  defaultRuntime: unknown
): RuntimeDescriptor | null {
  const picked = normalizeRuntimeId(runtimes, id) || normalizeRuntimeId(runtimes, defaultRuntime);
  return picked ? runtimes.find((d) => d.id === picked) ?? null : null;
}

/**
 * Why the Stop control is not offered, or `null` when it is. It refuses the CONTROL, never the
 * launch: main does not block a launch on it and the web must not either.
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

/** Absent ⇒ the live model picker is hidden on a running agent. */
export const canSwitchModelLive = (
  d: RuntimeDescriptor | null | undefined
): boolean => d?.session?.liveModelSwitch === true;

/**
 * This runtime's Axis-A vocabulary in its own order. ⚠ The order is load-bearing: `[0]` is the
 * fail-closed mode every coercion lands on and the last is the widest. Empty = no descriptor.
 */
export const toolModeOptions = (
  d: RuntimeDescriptor | null | undefined
): ReadonlyArray<RuntimeModeOption> => d?.toolMode?.options ?? NO_OPTIONS;

/** Fail-closed coercion of a stored Axis-A word into THIS runtime's vocabulary, as main does. */
export function normalizeToolMode(
  d: RuntimeDescriptor | null | undefined,
  mode: unknown
): string | null {
  const modes = toolModeOptions(d).map((o) => o.value);
  if (!modes.length) return null;
  return modes.indexOf(String(mode)) === -1 ? modes[0] : String(mode);
}

/** Codex's `sandbox_mode`, Cursor's `sandbox`. `null` on Claude, which renders nothing. */
export const secondaryAxis = (
  d: RuntimeDescriptor | null | undefined
): RuntimeSecondaryAxis | null => d?.toolMode?.secondaryAxis ?? null;

/** The platform's own approval category names, rendered verbatim, or empty. */
export const approvalCategories = (
  d: RuntimeDescriptor | null | undefined
): ReadonlyArray<string> => d?.approval?.categories ?? NO_CATEGORIES;

const CATEGORY_GRANULARITY = "category";
const GRANULAR_MODE = "granular";

/**
 * The Axis-A option the approval categories hang under, or `null`. The descriptor does not carry
 * this join, so it is made here, gated on both declarations (descriptor debt, F-391).
 * ⚠ `granular` is matched against the runtime's own option values, never used as a label.
 */
export function approvalCategoryMode(
  d: RuntimeDescriptor | null | undefined
): string | null {
  if (d?.approval?.granularity !== CATEGORY_GRANULARITY) return null;
  if (!approvalCategories(d).length) return null;
  const named = toolModeOptions(d).find((o) => o.value === GRANULAR_MODE);
  return named ? named.value : null;
}

/** Cursor's classifier instructions — `null` on every shipped adapter; rendered when declared. */
export const freeform = (
  d: RuntimeDescriptor | null | undefined
): RuntimeFreeform | null => d?.toolMode?.freeform ?? null;
