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
  const taken = new Set<string>();
  const out: K[] = [];
  for (let i = 0; i < n; i++) {
    const key = pickAgentColor(taken, palette);
    if (key === null) break;
    taken.add(key);
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

  it("fills every key once and then answers null (never reuses a live key)", () => {
    const all = launch(AGENT_COLOR_KEYS.length + 3);
    expect(all).toHaveLength(AGENT_COLOR_KEYS.length);
    expect(new Set(all).size).toBe(AGENT_COLOR_KEYS.length);
    expect(pickAgentColor(new Set(AGENT_COLOR_KEYS))).toBeNull();
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

  it("wraps a full bank and then answers null", () => {
    const palette = wheel(7);
    expect(launch(10, palette)).toHaveLength(7);
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
