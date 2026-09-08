/**
 * THE NEW-AGENT POPUP'S RUNTIME ROW — its ROSTER, its LABELS and its PRESELECT, as pure functions.
 *
 * ⚠ WHY IT IS ITS OWN FILE. `launch-agent-dialog.tsx` reached the §1 cap holding this, and the
 * seam is a real one rather than a size one: every rule here has exactly one reason to change —
 * a Samuel ruling about what the Runtime row offers and which pill it opens on. The dialog keeps
 * the JSX, the identity fields and the launch lane.
 *
 * ⚠ NO REACT, NO HOOK, NO BRIDGE — `lib/runtime-capability.ts`'s own rule, for its own reason.
 * Everything here answers off the descriptor table the desktop already handed over.
 *
 * ⚠ **EVERY REPORTED RUNTIME IS AN OPTION, CONNECTED OR NOT, AND THAT IS THE WHOLE POINT OF THIS
 * FILE (2026-09-08, Samuel's correction to the pass that narrowed the row to the connected ones).**
 * Verbatim: *"No, even if the user does not have codex or cursor connected, I still want them to be
 * options there so that the user knows that those are options, so they can connect them. It should
 * just be logged in, like it is just put in their default, right? I did not say to remove them."*
 * So {@link runtimeRowOptions} maps the roster ONE-FOR-ONE — a `filter` in this file is the bug it
 * was written to prevent — and connectivity buys exactly two things: a muted hint on the pills that
 * would not start today, and a {@link pickRuntime} that opens on one that would.
 */

import {
  normalizeRuntimeId,
  type RuntimeDescriptor,
} from "../../lib/runtime-capability";

/** ⚠ Module-level, so a surface with no runtime concept hands the same array every render —
 *  the popup memoizes this row on both of these. */
export const EMPTY_RUNTIMES: ReadonlyArray<RuntimeDescriptor> = [];
export const EMPTY_CONNECTED: ReadonlyArray<string> = [];

/** What an unconnected pill says. ⚠ TWO WORDS, NOT A SENTENCE (INVARIANTS §5, the minimal-copy
 *  ruling): the row states a fact about this Mac; it does not teach an install. */
export const NOT_CONNECTED = "not connected";

/**
 * THE ROW'S OPTIONS — every reported runtime, in the desktop's own order, under the PLATFORM's own
 * label (Dopl renames no vendor's product, and a second table of names is the drift
 * `lib/agent-models.ts` forbids).
 *
 * ⚠ THE HINT RIDES `SegmentedControl`'s OWN SLOT, so it reaches the accessible name as well as the
 * face — the same two places the template marker uses.
 * ⚠ NO HINTS AT ALL WHILE `connectedKnown` IS FALSE. A desktop older than 2026-09-08 reports no
 * connectivity, and stamping "not connected" on every pill of a machine running three runtimes
 * perfectly well is exactly the UNKNOWN-read-as-EMPTY failure INVARIANTS §8 and §11 forbid.
 */
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
 * WHICH RUNTIME THE ROW OPENS ON — the whole chain, in one place, so no reader has to assemble it
 * from three `??`s at a call site:
 *
 *   1. the OPERATOR'S own pick, whatever its connectivity;
 *   2. the CHANNEL'S stored pick, if it is connected — or if this desktop did not say;
 *   3. the first REPORTED runtime that is connected;
 *   4. the first REPORTED runtime.
 *
 * ⚠ LINK 1 IGNORES CONNECTIVITY ON PURPOSE. The operator just clicked that pill, and a control
 * that moved the selection off it because a 60s-stale probe disagreed would be a control that lies.
 * ⚠ LINK 2 IS THE CORRECTION'S OTHER HALF — *"It should just be what the user is already connected
 * to … In my case, I'm connected to Claude Code, so it should be Claude Code."* A stored pick this
 * Mac cannot start is not what the operator is connected to, so it yields.
 * ⚠ LINK 2's `!connectedKnown` IS THE OLDER-DESKTOP LANE (INVARIANTS §8). A build that reports no
 * connectivity must behave exactly as it did before this field existed — stored pick wins — rather
 * than have it overruled by an absence read as "nothing is connected".
 * ⚠ LINK 4 IS THE "NOTHING CONNECTED" FLOOR, and it is not decoration: a launch runs on exactly one
 * runtime, so a row that could select NONE while three are on screen would be a spawn nobody named.
 *
 * ⚠ NOT `runtime-capability.ts › descriptorFor`, AND THE DIFFERENCE IS NOT STYLISTIC: that helper
 * answers "what would this CHANNEL launch on", so it back-fills the first descriptor for an empty
 * id — which would make link 1 swallow links 2-4 the moment `panel.runtime` was `''`.
 * ⚠ `null` ONLY WHERE NOTHING WAS REPORTED — the plain browser and the pre-port desktop, which is
 * the one lane where this popup renders no row and sends no runtime key.
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
