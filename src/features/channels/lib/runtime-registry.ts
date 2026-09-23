/**
 * THE REGISTRY, AS THE WIRE HANDS IT OVER — turning a desktop bridge reply into
 * descriptors, and one id into the descriptor a launch would actually use.
 *
 * ⚠ §1 SPLIT OUT OF `runtime-capability.ts` (2026-09-21, U10), AND IT IS A SPLIT
 * BY REASON TO CHANGE RATHER THAN A SPACE-MAKING MOVE — the same seam
 * `main/runtime/selection-vocabulary.js` was cut on, one wave earlier. That file
 * states its own rule in its header: *"The ONE reason this file changes is that
 * `main/runtime/capability.js` changed."* Everything below changes for a
 * different reason entirely — when the WIRE changes: which keys a
 * `getLaunchPosture` reply carries, what an older desktop omits, and how an
 * unknown id fails toward the default. Those two clocks had already come apart,
 * and the file was over the 500-line cap with both of them in it.
 *
 * ⚠ RE-EXPORTED FROM `runtime-capability.ts`, so no caller and no suite moved —
 * the idiom `capability.js` and `channel-prefs.js` both set on the desktop side.
 *
 * ⚠ NO HOOK, NO BRIDGE, NO REACT, exactly as before: anything that reaches
 * `window.dopl` belongs in a hook, anything that renders belongs in a component.
 * This file decides nothing; it reads what the desktop already said.
 */

import type { RuntimeDescriptor } from "./runtime-capability";

// ── THE REGISTRY, AS THE WIRE HANDS IT OVER ──────────────────────────────────

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
