/**
 * The New Agent dialog's Runtime row as pure functions. Every reported runtime is an option,
 * connected or not (never filter the roster); connectivity only adds the hint and orders the preselect.
 */

import {
  normalizeRuntimeId,
  type RuntimeDescriptor,
} from "../lib/runtime-capability";

/** Two words, not a sentence (INVARIANTS §5). */
const NOT_CONNECTED = "not connected";

/** One option per reported runtime; no hints while `connectedKnown` is false (unknown ≠ empty). */
export function runtimeRowOptions(
  runtimes: ReadonlyArray<RuntimeDescriptor>,
  connected: ReadonlyArray<string>,
  connectedKnown: boolean
): Array<{ key: string; label: string; hint?: string }> {
  return runtimes.map((d) => ({
    key: d.id,
    label: d.label,
    hint: connectedKnown && !connected.includes(d.id) ? NOT_CONNECTED : undefined,
  }));
}

/**
 * The preselect: (1) `own` (the operator's pick, else the identity's runtime), ignoring
 * connectivity; (2) the channel's `stored` pick if connected, or kept when `!connectedKnown`
 * (unknown ≠ empty); (3) the first connected; (4) the first reported. `null` only when none reported.
 * Not `descriptorFor`: it back-fills the first descriptor for `''`, swallowing links 2–4.
 */
export function pickRuntime(
  runtimes: ReadonlyArray<RuntimeDescriptor>,
  own: string,
  stored: string,
  connected: ReadonlyArray<string>,
  connectedKnown: boolean
): RuntimeDescriptor | null {
  const reported = (id: string): RuntimeDescriptor | null => {
    const norm = normalizeRuntimeId(runtimes, id);
    return (norm && runtimes.find((d) => d.id === norm)) || null;
  };
  const ownPick = reported(own);
  if (ownPick) return ownPick;
  const storedPick = reported(stored);
  if (storedPick && (!connectedKnown || connected.includes(storedPick.id))) return storedPick;
  const live = runtimes.find((d) => connected.includes(d.id));
  if (live) return live;
  return runtimes[0] ?? null;
}
