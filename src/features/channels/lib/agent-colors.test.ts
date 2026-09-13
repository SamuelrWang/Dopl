/**
 * **THE COLOUR BANK AND THE ASSIGNMENT POLICY** (Samuel, 2026-09-13;
 * docs/specs/agent-colors.md).
 *
 * ⚠ **WHAT THIS SUITE EXISTS FOR IS THE PAIRING BETWEEN A PURE FUNCTION AND A DATABASE
 * INDEX.** `firstFreeAgentColor` is the whole of "first free", and the thing that makes it
 * TRUE is `channel_sessions_channel_color_live_key` — a partial unique index this file cannot
 * execute. So the split is deliberate and so is the coverage: the POLICY is proved here
 * exhaustively and without a database, and the CONSTRAINT is proved by
 * `server/agent-color-schema.test.ts` reading the migration. A suite that mocked a taken set
 * and then asserted "no two agents share a colour" would be asserting about its own mock.
 *
 * ⚠ **AND THE OTHER HALF IS THE NARROWING**, which is the only thing standing between a
 * TEXT column written by somebody else's machine and a `var(--agent-color-…)` substitution.
 * An unknown key must read as "no colour" — the neutral box — and never as a token name that
 * resolves to nothing and paints an invisible border.
 */

import { describe, it, expect } from "vitest";
import {
  AGENT_COLOR_KEYS,
  agentColorOrNull,
  agentColorVar,
  firstFreeAgentColor,
  freeAgentColors,
  isAgentColorKey,
} from "./agent-colors";

describe("the bank — sixteen keys, and the order IS the policy", () => {
  it("holds exactly sixteen, with no duplicate", () => {
    // ⚠ SIXTEEN IS NOT A ROUND NUMBER, IT IS ONE MORE THAN THE AGENT CAP (15 per workspace,
    // Samuel 2026-09-01) — so a FULL room still has a spare rather than an uncoloured agent.
    // A change to either number is a decision about the other.
    expect(AGENT_COLOR_KEYS).toHaveLength(16);
    expect(new Set(AGENT_COLOR_KEYS).size).toBe(16);
  });

  it("is `agent-01 … agent-16`, zero-padded, in ascending order", () => {
    // ⚠ THE SPELLING IS SHARED WITH FOUR OTHER SITES (`@dopl/contracts › AgentColorKey`, both
    // column CHECKs in `20261005120000`, and the MCP mirror), so a drifted pad or a skipped
    // number is a value legal on one hop and refused on the next.
    expect([...AGENT_COLOR_KEYS]).toEqual(
      Array.from({ length: 16 }, (_, i) => `agent-${String(i + 1).padStart(2, "0")}`)
    );
  });
});

describe("the narrowing — a TEXT column and a peer's machine are not to be trusted", () => {
  it("accepts every key in the bank", () => {
    for (const key of AGENT_COLOR_KEYS) expect(isAgentColorKey(key)).toBe(true);
  });

  it("refuses everything else, including the near misses", () => {
    // ⚠ THE NEAR MISSES ARE THE POINT. `agent-00`, `agent-17` and `agent-1` are all
    // "agent-" plus digits, so any test that only tried `"red"` would pass against a
    // `startsWith` check — and `startsWith` is exactly the shortcut that would let
    // `agent-99` reach `agentColorVar` and paint nothing.
    for (const bad of [
      "agent-00",
      "agent-17",
      "agent-1",
      "agent-016",
      "AGENT-01",
      "agent-01 ",
      " agent-01",
      "red",
      "",
      "#ff0000",
      "var(--agent-color-01)",
    ]) {
      expect(isAgentColorKey(bad), bad).toBe(false);
      expect(agentColorOrNull(bad), bad).toBeNull();
    }
  });

  it("refuses every non-string, rather than throwing on one", () => {
    // ⚠ IT IS CALLED ON A JSON VALUE off a poll payload and on a field split out of a
    // serialized memo key, so `null` / `undefined` / a number are ORDINARY inputs here, not
    // abuse — and a throw would take down a whole transcript render.
    for (const bad of [null, undefined, 3, {}, [], true]) {
      expect(isAgentColorKey(bad)).toBe(false);
      expect(agentColorOrNull(bad)).toBeNull();
    }
  });
});

describe("the token reference — the only place a key becomes paint", () => {
  it("maps a key to its custom property, for all sixteen", () => {
    // ⚠ ASSERTED OVER THE WHOLE BANK rather than one example, because the mapping is a STRING
    // SUBSTITUTION: a key whose token does not exist resolves to nothing and paints an
    // invisible border, which is the one rendering failure that looks like "no box" instead
    // of like a bug. The tokens themselves are held to the two palettes by
    // `scripts/check-css-token-drift.ts`.
    for (const key of AGENT_COLOR_KEYS) {
      expect(agentColorVar(key)).toBe(`var(--agent-color-${key.slice(6)})`);
    }
    expect(agentColorVar("agent-03")).toBe("var(--agent-color-03)");
  });
});

describe("first free — the assignment, which is the array's order", () => {
  it("hands out `agent-01` in an empty room", () => {
    expect(firstFreeAgentColor(new Set())).toBe("agent-01");
  });

  it("skips what is held and takes the next in BANK order, not the next unheld number", () => {
    // ⚠ THE SET IS OUT OF ORDER ON PURPOSE. The policy is "walk the bank", not "walk the
    // taken set", so an implementation that sorted or scanned its input would answer
    // `agent-02` here for the wrong reason and pass a tidier fixture.
    expect(firstFreeAgentColor(new Set(["agent-03", "agent-01"]))).toBe("agent-02");
  });

  it("walks past a contiguous run", () => {
    const taken = new Set(AGENT_COLOR_KEYS.slice(0, 9));
    expect(firstFreeAgentColor(taken)).toBe("agent-10");
  });

  it("answers `null` when all sixteen are out — and that is NEVER a refusal", () => {
    // ⚠ THE PROPERTY IS "A LAUNCH IS NOT REFUSED OVER A DECORATION" (Samuel's ruling read
    // through: a colour is identity, not entitlement). A seventeenth live agent in one room
    // runs UNCOLOURED and its posts wear the neutral box; `null` is what says so, and the
    // column is nullable for exactly this case.
    expect(firstFreeAgentColor(new Set(AGENT_COLOR_KEYS))).toBeNull();
  });

  it("ignores a taken value that is not a key at all", () => {
    // ⚠ THE TAKEN SET IS BUILT FROM A TEXT COLUMN (`repository-session-colors.ts`), so junk
    // in it is possible — and junk must not be able to consume a key. `agent-01` is still
    // first free here.
    expect(firstFreeAgentColor(new Set(["red", "agent-99"]))).toBe("agent-01");
  });
});

describe("the free set — what a 409 hands back and what the popup renders", () => {
  it("is the bank minus the taken, in BANK order", () => {
    // ⚠ ORDER MATTERS BECAUSE THE TWO ANSWERS MUST AGREE: the caller is told "pick from
    // this list", and the first entry has to be the key `firstFreeAgentColor` would itself
    // have chosen, or the advice and the assignment disagree on a retry.
    const taken = new Set(["agent-02", "agent-05"]);
    const free = freeAgentColors(taken);
    expect(free).toHaveLength(14);
    expect(free[0]).toBe(firstFreeAgentColor(taken));
    expect(free).not.toContain("agent-02");
    expect(free).not.toContain("agent-05");
    expect([...free]).toEqual(
      AGENT_COLOR_KEYS.filter((k) => k !== "agent-02" && k !== "agent-05")
    );
  });

  it("is empty exactly when `firstFreeAgentColor` is null", () => {
    const full = new Set(AGENT_COLOR_KEYS);
    expect(freeAgentColors(full)).toHaveLength(0);
    expect(firstFreeAgentColor(full)).toBeNull();
  });
});
