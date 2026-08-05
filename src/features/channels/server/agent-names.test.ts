/**
 * Unit tests for the agent handle pool + picker. Pure module, no mocks.
 *
 * THE MODULE HAS NO PRODUCTION CALLER RIGHT NOW, and this suite is why it can be trusted to
 * still work when it gets one. Summoning is gone (channels rollback §1); the plan's §3.3
 * reuses this exact pool to name SESSION PILLS, so the contract below is what phase 3 will
 * build on rather than dead code kept out of sentiment.
 *
 * The contract under test: `pickAgentName` is the only thing standing between a
 * summon and a 409, so it must (a) never return a handle the caller already
 * holds, (b) never return one the DB's charset CHECK would reject, and (c) keep
 * producing distinct handles past the end of the pool instead of throwing or
 * looping.
 */

import { describe, it, expect } from "vitest";
import { AGENT_NAME_POOL, pickAgentName } from "./agent-names";

/** The `channel_agents.name` CHECK, restated here so drift fails a test. */
const HANDLE_CHARSET = /^[a-z][a-z0-9-]{1,30}$/;

describe("the generator survives the rollback", () => {
  it("is still importable, and still yields a name", () => {
    // The one thing §3.3 needs from it, pinned as an explicit statement rather than left
    // implicit in the cases below: a future session-pill caller can import this module and
    // get a handle out of it with no other machinery alive.
    expect(typeof pickAgentName).toBe("function");
    expect(pickAgentName(new Set())).toBe(AGENT_NAME_POOL[0]);
  });
});

describe("AGENT_NAME_POOL", () => {
  it("has ~60 handles and no duplicates", () => {
    expect(AGENT_NAME_POOL.length).toBe(60);
    expect(new Set(AGENT_NAME_POOL).size).toBe(AGENT_NAME_POOL.length);
  });

  it("every entry matches the DB charset CHECK", () => {
    const bad = AGENT_NAME_POOL.filter((n) => !HANDLE_CHARSET.test(n));
    expect(bad).toEqual([]);
  });
});

describe("pickAgentName", () => {
  it("returns the first pool handle when nothing is taken", () => {
    expect(pickAgentName(new Set())).toBe(AGENT_NAME_POOL[0]);
  });

  it("skips taken handles and returns the first free one", () => {
    const taken = new Set(AGENT_NAME_POOL.slice(0, 3));
    expect(pickAgentName(taken)).toBe(AGENT_NAME_POOL[3]);
  });

  it("compares CASE-FOLDED (the unique index is on lower(name))", () => {
    // A caller that read handles back with any casing must not be handed a
    // handle that differs only by case — the DB would reject it.
    const taken = new Set([AGENT_NAME_POOL[0]!.toUpperCase()]);
    expect(pickAgentName(taken)).toBe(AGENT_NAME_POOL[1]);
  });

  it("suffixes once the pool is exhausted", () => {
    const taken = new Set(AGENT_NAME_POOL);
    expect(pickAgentName(taken)).toBe(`${AGENT_NAME_POOL[0]}-2`);
  });

  it("sweeps the whole pool per suffix round rather than exhausting one base", () => {
    const taken = new Set([...AGENT_NAME_POOL, `${AGENT_NAME_POOL[0]}-2`]);
    expect(pickAgentName(taken)).toBe(`${AGENT_NAME_POOL[1]}-2`);
  });

  it("moves to the next round only after a full sweep", () => {
    const taken = new Set([
      ...AGENT_NAME_POOL,
      ...AGENT_NAME_POOL.map((n) => `${n}-2`),
    ]);
    expect(pickAgentName(taken)).toBe(`${AGENT_NAME_POOL[0]}-3`);
  });

  it("never repeats itself over deep exhaustion, and stays inside the charset", () => {
    // Simulate a channel that summons far past the pool: feed each pick back in
    // as taken. Any duplicate or charset-invalid handle is a 409 waiting to
    // happen. 200 picks crosses three suffix rounds.
    const taken = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const name = pickAgentName(taken);
      expect(taken.has(name)).toBe(false);
      expect(HANDLE_CHARSET.test(name)).toBe(true);
      taken.add(name);
    }
    expect(taken.size).toBe(200);
  });

  it("is deterministic — the same room state yields the same next handle", () => {
    const state = () => new Set([AGENT_NAME_POOL[0]!, AGENT_NAME_POOL[1]!]);
    expect(pickAgentName(state())).toBe(pickAgentName(state()));
  });
});
