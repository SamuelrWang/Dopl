/**
 * **WHICH FREE COLOUR A NEW AGENT GETS: THE ONE THAT LOOKS LEAST LIKE ANY LIVE ONE**
 * (Samuel, 2026-10-08).
 *
 * The old rule walked the bank in key order, and neighbouring keys are neighbouring hues
 * (red → red-orange → orange), so two or three sibling agents came out indistinguishable.
 * This picks by MEASURED colour instead of by position:
 *
 *  1. Only FREE keys are candidates. Two live agents in one channel never share a key — the
 *     partial unique index `channel_sessions_channel_color_live_key` says so, and this policy
 *     only exists to stay clear of it. So "every key taken" is still `null` (the agent runs
 *     uncoloured, never refused); reusing a held key is not an option this table allows.
 *  2. Empty room ⇒ the first key in bank order, so the first agent's colour is predictable.
 *  3. Otherwise each free key scores its DISTANCE to the NEAREST live colour, as ΔE in OKLab
 *     (Euclidean over L, a = C·cos h, b = C·sin h — the space the tokens are written in), and
 *     the highest score wins. Ties fall to the larger summed distance, then to bank order, so
 *     the answer is deterministic.
 *
 * ⚠ **NO ORDER, STRIDE OR SIZE IS ASSUMED.** The score is computed from the palette's actual
 * values, so re-ordering the keys, re-tuning a hue, or growing / shrinking the bank keeps the
 * spread without touching this file. The values are `agent-color-values.ts`, which a test holds
 * equal to the CSS tokens — a palette edit that forgets one side fails the suite.
 *
 * ⚠ PURE: takes the taken set, never reads it (the repository does), so every caller — the
 * launch directive, the push reconcile, the New-agent dialog's default — runs this one rule.
 */
import type { AgentColorKey } from "@dopl/contracts";
import { AGENT_COLOR_KEYS } from "./agent-colors";
import { AGENT_COLOR_VALUES, type Oklch } from "./agent-color-values";

/** Ties closer than this are ties: the inputs are 2-3 decimal tokens, not measurements. */
const EPSILON = 1e-9;

/** OKLCH → OKLab, the space ΔE is measured in. */
function toLab({ l, c, h }: Oklch): [number, number, number] {
  const rad = (h * Math.PI) / 180;
  return [l, c * Math.cos(rad), c * Math.sin(rad)];
}

/** ΔE_OK between two colours. */
export function oklabDistance(x: Oklch, y: Oklch): number {
  const [l1, a1, b1] = toLab(x);
  const [l2, a2, b2] = toLab(y);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/** The palette a ranking runs over. Injectable so a test can reorder or resize it. */
export interface AgentColorPalette<K extends string = AgentColorKey> {
  /** Bank order — the tie-break and the empty-room answer, nothing more. */
  keys: readonly K[];
  values: Readonly<Record<K, Oklch>>;
}

const DEFAULT_PALETTE: AgentColorPalette = {
  keys: AGENT_COLOR_KEYS,
  values: AGENT_COLOR_VALUES,
};

/**
 * Every FREE key, best first. The head is what {@link pickAgentColor} returns, so a 409 that
 * hands this list back advises exactly the key the server would itself assign.
 * ⚠ Junk in `taken` (a text column, a peer's newer key) is ignored, never allowed to consume a
 * key or to anchor a distance.
 */
export function rankFreeAgentColors(taken: ReadonlySet<string>): AgentColorKey[];
export function rankFreeAgentColors<K extends string>(
  taken: ReadonlySet<string>,
  palette: AgentColorPalette<K>
): K[];
export function rankFreeAgentColors(
  taken: ReadonlySet<string>,
  palette: AgentColorPalette<string> = DEFAULT_PALETTE
): string[] {
  const { keys, values } = palette;
  const free = keys.filter((k) => !taken.has(k));
  const anchors = keys.filter((k) => taken.has(k)).map((k) => values[k]);
  if (anchors.length === 0) return free;
  const scored = free.map((key, order) => {
    const distances = anchors.map((a) => oklabDistance(values[key], a));
    return {
      key,
      order,
      nearest: Math.min(...distances),
      total: distances.reduce((sum, d) => sum + d, 0),
    };
  });
  scored.sort((x, y) => {
    if (Math.abs(x.nearest - y.nearest) > EPSILON) return y.nearest - x.nearest;
    if (Math.abs(x.total - y.total) > EPSILON) return y.total - x.total;
    return x.order - y.order;
  });
  return scored.map((s) => s.key);
}

/** The assignment: the free key most distinct from every live one; `null` when none is free. */
export function pickAgentColor(taken: ReadonlySet<string>): AgentColorKey | null;
export function pickAgentColor<K extends string>(
  taken: ReadonlySet<string>,
  palette: AgentColorPalette<K>
): K | null;
export function pickAgentColor(
  taken: ReadonlySet<string>,
  palette: AgentColorPalette<string> = DEFAULT_PALETTE
): string | null {
  return rankFreeAgentColors(taken, palette)[0] ?? null;
}
