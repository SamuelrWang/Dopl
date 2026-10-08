/**
 * 🔒 SAMUEL, 2026-10-08 — a new agent's default colour is the FREE key most distinct from the
 * colours already live in the channel, measured from the palette's values, never from key order.
 */
import { describe, expect, it } from "vitest";
import type { AgentColorKey } from "@dopl/contracts";
import { AGENT_COLOR_KEYS } from "./agent-colors";
import { AGENT_COLOR_VALUES, type Oklch } from "./agent-color-values";
import {
  oklabDistance,
  pickAgentColor,
  rankFreeAgentColors,
  type AgentColorPalette,
} from "./agent-color-pick";

/** Minimum pairwise ΔE across a set of keys, under a palette. */
function minPairwise<K extends string>(keys: K[], values: Record<K, Oklch>): number {
  let min = Infinity;
  for (let i = 0; i < keys.length; i++)
    for (let j = i + 1; j < keys.length; j++)
      min = Math.min(min, oklabDistance(values[keys[i]], values[keys[j]]));
  return min;
}

/** Launch `n` agents one after another, each taking the picker's answer. */
function launch<K extends string = AgentColorKey>(
  n: number,
  palette: AgentColorPalette<K> = { keys: AGENT_COLOR_KEYS, values: AGENT_COLOR_VALUES } as unknown as AgentColorPalette<K>
): K[] {
  const taken = new Map<string, number>();
  const out: K[] = [];
  for (let i = 0; i < n; i++) {
    const key = pickAgentColor(taken, palette);
    if (key === null) break;
    taken.set(key, (taken.get(key) ?? 0) + 1);
    out.push(key);
  }
  return out;
}

/** A hue wheel of `n` evenly spaced keys `k00…`, in the given order. */
function wheel(n: number, order: (i: number) => number = (i) => i): AgentColorPalette<string> {
  const keys = Array.from({ length: n }, (_, i) => `k${String(order(i)).padStart(2, "0")}`);
  const values: Record<string, Oklch> = {};
  for (let i = 0; i < n; i++) {
    values[`k${String(i).padStart(2, "0")}`] = { l: 0.5, c: 0.1, h: (360 * i) / n };
  }
  return { keys, values };
}

describe("the real bank", () => {
  it("gives the first agent in an empty room the first key", () => {
    expect(pickAgentColor(new Set())).toBe(AGENT_COLOR_KEYS[0]);
  });

  it("puts the second agent across the wheel, never next door", () => {
    const [first, second] = launch(2);
    const h1 = AGENT_COLOR_VALUES[first].h;
    const h2 = AGENT_COLOR_VALUES[second].h;
    const gap = Math.min(Math.abs(h1 - h2), 360 - Math.abs(h1 - h2));
    expect(gap).toBeGreaterThanOrEqual(170);
  });

  it("spreads sequential launches far better than walking the bank in order", () => {
    for (const n of [3, 4, 5, 8]) {
      const picked = launch(n);
      const inOrder = AGENT_COLOR_KEYS.slice(0, n);
      expect(new Set(picked).size).toBe(n);
      expect(minPairwise(picked, AGENT_COLOR_VALUES)).toBeGreaterThan(
        minPairwise([...inOrder], AGENT_COLOR_VALUES) * 1.9
      );
    }
  });

  it("measures against what is live, whatever order it was taken in", () => {
    // agent-01 (20°) live: the best answer is the hue opposite it, agent-09 (200°).
    expect(pickAgentColor(new Set(["agent-01"]))).toBe("agent-09");
    // A gap left by an ENDED agent is refilled where it is most distinct, not by number.
    expect(pickAgentColor(new Set(["agent-05", "agent-13"]))).toBe("agent-01");
  });

  it("fills every key once, then CIRCLES BACK (Samuel 2026-10-08) instead of answering null", () => {
    const first = launch(AGENT_COLOR_KEYS.length);
    expect(new Set(first).size).toBe(AGENT_COLOR_KEYS.length);
    const full = new Set(AGENT_COLOR_KEYS);
    expect(pickAgentColor(full)).not.toBeNull();
  });

  it("ignores junk in the taken set — it neither consumes a key nor anchors a distance", () => {
    expect(pickAgentColor(new Set(["red", "agent-99"]))).toBe(AGENT_COLOR_KEYS[0]);
  });

  it("ranks the free keys with the pick at the head", () => {
    const taken = new Set(["agent-02", "agent-11"]);
    const ranked = rankFreeAgentColors(taken);
    expect(ranked[0]).toBe(pickAgentColor(taken));
    expect([...ranked].sort()).toEqual(AGENT_COLOR_KEYS.filter((k) => !taken.has(k)).sort());
  });

  it("is deterministic", () => {
    expect(launch(6)).toEqual(launch(6));
  });
});

describe("the policy survives a palette change", () => {
  it("still spreads when the bank is REORDERED", () => {
    // Keys listed in a scrambled order: the order must not decide the spread.
    const scrambled = wheel(16, (i) => (i * 7) % 16);
    const picked = launch(4, scrambled);
    expect(minPairwise(picked, scrambled.values)).toBeGreaterThan(
      oklabDistance({ l: 0.5, c: 0.1, h: 0 }, { l: 0.5, c: 0.1, h: 80 })
    );
  });

  it("still spreads when the bank is RESIZED", () => {
    for (const n of [5, 9, 24]) {
      const palette = wheel(n);
      const picked = launch(3, palette);
      // Greedy never moves a live agent, so three on a wheel land opposite, then at the quarter:
      // no two closer than 90° minus one step of the wheel, whatever its size.
      const step = 360 / n;
      const floor = oklabDistance({ l: 0.5, c: 0.1, h: 0 }, { l: 0.5, c: 0.1, h: 90 - step });
      expect(minPairwise(picked, palette.values)).toBeGreaterThanOrEqual(floor - 1e-9);
    }
  });

  it("wraps a full bank and keeps going, spreading reuse", () => {
    const palette = wheel(7);
    const picked = launch(10, palette);
    expect(picked).toHaveLength(10);
    // The first seven are distinct; the reuses are distinct from each other too.
    expect(new Set(picked.slice(0, 7)).size).toBe(7);
    expect(new Set(picked.slice(7)).size).toBe(3);
  });

  it("uses lightness too, not hue alone", () => {
    // Same hue, very different lightness, beats a near hue at the same lightness.
    const palette: AgentColorPalette<"a" | "b" | "c"> = {
      keys: ["a", "b", "c"],
      values: {
        a: { l: 0.5, c: 0.1, h: 0 },
        b: { l: 0.5, c: 0.1, h: 15 },
        c: { l: 0.95, c: 0.1, h: 0 },
      },
    };
    expect(pickAgentColor(new Set(["a"]), palette)).toBe("c");
  });
});

describe("full bank: circling back (Samuel, 2026-10-08)", () => {
  const all = (extra: Record<string, number> = {}) =>
    new Map<string, number>([...AGENT_COLOR_KEYS.map((k) => [k, 1] as [string, number]), ...Object.entries(extra)]);

  it("every key held once: reuses the first in bank order (all tied)", () => {
    expect(pickAgentColor(all())).toBe(AGENT_COLOR_KEYS[0]);
  });

  it("reuses a key with the FEWEST holders, never one already doubled", () => {
    expect(pickAgentColor(all({ "agent-01": 2 }))).not.toBe("agent-01");
  });

  it("among the least-held, takes the one FARTHEST from the busier keys", () => {
    // agent-01 (20°) is doubled: the next reuse is across the wheel, agent-09 (200°).
    expect(pickAgentColor(all({ "agent-01": 2 }))).toBe("agent-09");
  });

  it("the free-key list stays free keys only (a 409 offers nothing to steal)", () => {
    expect(rankFreeAgentColors(all())).toEqual([]);
  });
});
