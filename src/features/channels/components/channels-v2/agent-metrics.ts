/**
 * Channels v2 — AN AGENT'S NUMBERS, AND THE ABSENCE OF ONE. The two pure
 * readers every agent surface shares: the Agents tab's cards, the agent panel
 * and the agent window (`grep -rn "from \"./agent-metrics\"" src`).
 *
 * ⚠ ITS OWN FILE SINCE 2026-08-22, AND THE REASON TO CHANGE IS THE SPLIT
 * (INVARIANTS §1). `agents-model.ts` is the SESSION PROJECTION — which agents
 * exist, whose they are, what state they are in — and it moves whenever the
 * desktop's feed or a liveness rule does. This is DISPLAY of a measurement, and
 * it moves when the meters do. Keeping them together is what put that file at
 * the cap, where its next docblock correction would have been a split anyway.
 *
 * ⚠ NOT RE-EXPORTED THROUGH `agents-model.ts`. A barrel would leave every
 * consumer importing from the old path and make the seam invisible — the mistake
 * the `permission-modes.ts` tangle is named for, and the one that file's own
 * footer warns about for `agents-controls.ts`.
 */

/** `84_000` → `"84k"`. Tokens are only ever glanced at here; the exact integer is
 *  noise at caption size, and above a million the thousands are too. */
export function formatTokens(value: number): string {
  if (value >= 1_000_000) {
    const m = value / 1_000_000;
    return `${m >= 10 ? Math.round(m) : m.toFixed(1)}M`;
  }
  return `${Math.round(value / 1000)}k`;
}

/**
 * A metric, or `null`. ⚠ The one place the wire's three absences collapse into
 * one: an older main omits the field, a model this build has no window for has
 * no denominator, and nothing is measured before the first turn reports usage.
 * All three mean "cannot say", and NONE of them means zero — a context meter
 * reading 0% of a window that is nearly full is a lie the operator acts on.
 */
export function metric(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}
