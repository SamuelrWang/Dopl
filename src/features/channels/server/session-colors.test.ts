/**
 * 🔒 THE PUSH LANE'S COLOUR RULES (`session-colors.ts › resolveReportedColors`), incl. the
 * full-bank reuse (Samuel, 2026-10-08: "it can circle back").
 *  - While a key is free, no two live agents in a channel share one — within a batch and against
 *    another member's (or a concurrent launch's) exclusive claim.
 *  - With every key held, a new agent SHARES a key (`color_shared`), spread across keys.
 *  - A shared incumbent keeps its key; an exclusive incumbent beaten by an exclusive foreign
 *    claim moves (the unique index would refuse it otherwise).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AGENT_COLOR_KEYS } from "../lib/agent-colors";
import { pickAgentColor } from "../lib/agent-color-pick";
import { resolveReportedColors, type ChannelColorClaims } from "./session-colors";
import { withoutClaimedColors } from "./repository-session-colors";
import type { SessionStateUpsert } from "./collab-dto";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: () => ({}) }));

const CHAN = "chan-1";

function row(session_key: string, color: string | null = null): SessionStateUpsert {
  return { session_key, channel_id: CHAN, color } as unknown as SessionStateUpsert;
}

function foreign(keys: string[], sharedKeys: string[] = []): Map<string, ChannelColorClaims> {
  const holders = new Map<string, number>();
  for (const k of [...keys, ...sharedKeys]) holders.set(k, (holders.get(k) ?? 0) + 1);
  return new Map([[CHAN, { holders, exclusive: new Set(keys) }]]);
}

const run = (
  reported: SessionStateUpsert[],
  foreignColors = new Map<string, ChannelColorClaims>(),
  storedColors = new Map<string, { color: string | null; shared: boolean }>()
) => resolveReportedColors({ reported, storedColors, foreignColors });

describe("while a key is free", () => {
  it("two sessions in one batch asking for the SAME key get different keys, both exclusive", () => {
    const out = run([row("a", "agent-01"), row("b", "agent-01")]);
    expect(out[0]).toMatchObject({ color: "agent-01", color_shared: false });
    expect(out[1].color).not.toBe("agent-01");
    expect(out[1].color_shared).toBe(false);
  });

  it("CONCURRENT LAUNCHES: both directives recorded one free key; the second push is moved off it", () => {
    // Two launches read the taken set before either filed, so both asked for the same key. The
    // first agent's row exists (another machine's exclusive claim); the second must not share.
    const out = run([row("b", "agent-01")], foreign(["agent-01"]));
    expect(out[0].color).toBe(pickAgentColor(new Set(["agent-01"])));
    expect(out[0].color_shared).toBe(false);
  });

  it("never shares while any key is free", () => {
    const fifteen = AGENT_COLOR_KEYS.slice(0, 15);
    const out = run([row("new")], foreign([...fifteen]));
    expect(out[0]).toMatchObject({ color: AGENT_COLOR_KEYS[15], color_shared: false });
  });
});

describe("every key held: it circles back", () => {
  it("a new agent REUSES a key, marked shared, instead of running uncoloured", () => {
    const out = run([row("new")], foreign([...AGENT_COLOR_KEYS]));
    expect(out[0].color).not.toBeNull();
    expect(out[0].color_shared).toBe(true);
  });

  it("reuse spreads: a batch of new agents lands on different, far-apart keys", () => {
    const out = run([row("x"), row("y"), row("z")], foreign([...AGENT_COLOR_KEYS]));
    const keys = out.map((r) => r.color);
    expect(new Set(keys).size).toBe(3);
    expect(out.every((r) => r.color_shared === true)).toBe(true);
    // The second reuse sits across the wheel from the first.
    expect(keys[1]).toBe(pickAgentColor(new Map([...AGENT_COLOR_KEYS.map((k) => [k, 1] as const), [keys[0] as string, 2]])));
  });

  it("a requested key that is held is not granted; the reuse pick decides", () => {
    const out = run([row("new", "agent-03")], foreign([...AGENT_COLOR_KEYS]));
    expect(out[0].color_shared).toBe(true);
  });
});

describe("incumbents", () => {
  it("a SHARED incumbent keeps its key even though an exclusive holder has it", () => {
    const out = run(
      [row("mine")],
      foreign([...AGENT_COLOR_KEYS]),
      new Map([["mine", { color: "agent-05", shared: true }]])
    );
    expect(out[0]).toMatchObject({ color: "agent-05", color_shared: true });
  });

  it("an EXCLUSIVE incumbent beaten by an exclusive foreign claim moves", () => {
    const out = run(
      [row("mine")],
      foreign(["agent-05"]),
      new Map([["mine", { color: "agent-05", shared: false }]])
    );
    expect(out[0].color).not.toBe("agent-05");
    expect(out[0].color_shared).toBe(false);
  });

  it("an exclusive incumbent keeps its key when the foreign holder is only SHARING it", () => {
    const out = run(
      [row("mine")],
      foreign([], ["agent-05"]),
      new Map([["mine", { color: "agent-05", shared: false }]])
    );
    expect(out[0]).toMatchObject({ color: "agent-05", color_shared: false });
  });
});

it("the unique-violation degrade clears the shared flag with the colour", () => {
  const rows = [{ color: "agent-01", color_shared: true }];
  const error = { code: "23505", message: 'violates "channel_sessions_channel_color_live_key"' };
  expect(withoutClaimedColors(rows, error)).toEqual([{ color: null, color_shared: false }]);
});
