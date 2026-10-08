/**
 * **WHICH FREE COLOUR A NEW AGENT GETS: THE ONE THAT LOOKS LEAST LIKE ANY LIVE ONE**
 * (Samuel, 2026-10-08).
 *
 * The old rule walked the bank in key order, and neighbouring keys are neighbouring hues
 * (red → red-orange → orange), so two or three sibling agents came out indistinguishable.
 * This picks by MEASURED colour instead of by position:
 *
 *  1. FREE keys first. While one is free, two live agents in a channel never share a key (the
 *     partial unique index `channel_sessions_channel_color_live_key` holds it). Only when every
 *     key is held is one REUSED, marked `color_shared` so the index lets it through (2026-10-08).
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

/** What is live in the channel: a set (one holder each) or a count of holders per key. */
export type TakenColors = ReadonlySet<string> | ReadonlyMap<string, number>;

/** Holders per key, junk keys (not in the palette) dropped so they can neither consume a key nor
 *  anchor a distance. */
function holdersOf(taken: TakenColors, keys: readonly string[]): Map<string, number> {
  const known = new Set(keys);
  const out = new Map<string, number>();
  if (taken instanceof Map) {
    for (const [key, n] of taken) if (known.has(key) && n > 0) out.set(key, n);
  } else {
    for (const key of taken as ReadonlySet<string>) if (known.has(key)) out.set(key, 1);
  }
  return out;
}

/** `candidates` ranked by distance from `anchors` (nearest-first score, then total, then order). */
function rankAway(
  candidates: readonly string[],
  anchors: readonly string[],
  values: Readonly<Record<string, Oklch>>
): string[] {
  if (anchors.length === 0) return [...candidates];
  const scored = candidates.map((key, order) => {
    const distances = anchors.map((a) => oklabDistance(values[key], values[a]));
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

/**
 * Every FREE key, best first. The head is what {@link pickAgentColor} returns while one is free,
 * so a 409 that hands this list back advises exactly the key the server would itself assign.
 */
export function rankFreeAgentColors(taken: TakenColors): AgentColorKey[];
export function rankFreeAgentColors<K extends string>(
  taken: TakenColors,
  palette: AgentColorPalette<K>
): K[];
export function rankFreeAgentColors(
  taken: TakenColors,
  palette: AgentColorPalette<string> = DEFAULT_PALETTE
): string[] {
  const { keys, values } = palette;
  const holders = holdersOf(taken, keys);
  return rankAway(
    keys.filter((k) => !holders.has(k)),
    keys.filter((k) => holders.has(k)),
    values
  );
}

/**
 * **THE ASSIGNMENT.** A free key while one exists: the one most distinct from every live colour.
 * When every key is held (Samuel, 2026-10-08: "it can circle back"), a key is REUSED rather than
 * the agent running uncoloured: among the keys with the FEWEST live holders, the one farthest
 * from the keys held more often, then bank order. Fewest holders comes first because with every
 * key live, distance to "the live colours" is zero for all of them; spreading the reuse across
 * keys is what keeps neighbours apart. `null` only for an empty palette.
 */
export function pickAgentColor(taken: TakenColors): AgentColorKey | null;
export function pickAgentColor<K extends string>(
  taken: TakenColors,
  palette: AgentColorPalette<K>
): K | null;
export function pickAgentColor(
  taken: TakenColors,
  palette: AgentColorPalette<string> = DEFAULT_PALETTE
): string | null {
  const { keys, values } = palette;
  if (keys.length === 0) return null;
  const holders = holdersOf(taken, keys);
  const fewest = Math.min(...keys.map((k) => holders.get(k) ?? 0));
  const candidates = keys.filter((k) => (holders.get(k) ?? 0) === fewest);
  const busier = keys.filter((k) => (holders.get(k) ?? 0) > fewest);
  return rankAway(candidates, busier, values)[0] ?? null;
}
