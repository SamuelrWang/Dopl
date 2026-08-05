/**
 * THE HANDLE POOL IS DUPLICATED, AND THIS IS WHAT KEEPS THE COPIES HONEST.
 *
 * `dopl-desktop-app/main/agent-names.js` is a byte-for-byte port of `./agent-names.ts`.
 * The reason is a hard boundary rather than a preference: the desktop main process is
 * CommonJS with NO build step (`dopl-desktop-app/` is inert for the Vercel build — nothing
 * bundles it, nothing transpiles it), so it cannot import a TypeScript module from this
 * tree at all. Phase 3 of the channels rollback (plan §3.3) names sessions in MAIN, because
 * a name has to be the same fact in the channel pane, in the tray, and — phase 5 — over
 * MCP, and only main sees all three. Naming in the renderer instead would make a handle a
 * property of one window: different per surface, re-rolled on reload, invisible to MCP.
 *
 * So: two copies on purpose, and one test that fails if they drift. It lives HERE, in the
 * tree that owns the canonical module, and it reaches ACROSS to the desktop copy — the same
 * direction `permission-preset-row.test.tsx` already reads the desktop's posture labels.
 *
 * The pools are compared element-wise, and the two pickers are run over the same corpus of
 * taken-sets and required to agree on every one. Comparing behaviour and not just data is
 * the point: the suffix rule (sweep the whole pool per round, so a busy channel reads as
 * varied names rather than `quartz-2..quartz-9`) is the part a re-implementation gets
 * subtly wrong, and it is invisible in a pool diff.
 */

import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";
import { AGENT_NAME_POOL, pickAgentName } from "./agent-names";

const require_ = createRequire(import.meta.url);
const desktop = require_("../../../../dopl-desktop-app/main/agent-names.js") as {
  AGENT_NAME_POOL: readonly string[];
  pickAgentName: (taken: Set<string> | Iterable<string>) => string;
};

describe("the desktop copy of the handle pool", () => {
  it("is the same pool, in the same order", () => {
    // Order is load-bearing, not cosmetic: `pickAgentName` returns the FIRST free entry, so
    // a reordered copy hands out different names for the same channel state.
    expect(desktop.AGENT_NAME_POOL).toEqual([...AGENT_NAME_POOL]);
  });

  it("is frozen in main, where a caller could otherwise mutate the shared array", () => {
    // The web copy is a module-scoped `readonly string[]` the type system protects; main has
    // no type system, and its ledger hands the pool to a per-channel picker on every list().
    expect(Object.isFrozen(desktop.AGENT_NAME_POOL)).toBe(true);
  });
});

describe("the two pickers agree", () => {
  /** Taken-sets spanning empty, sparse, exhausted and deep-suffix channel states. */
  function corpus(): Set<string>[] {
    const cases: Set<string>[] = [
      new Set(),
      new Set(["quartz"]),
      new Set(["QUARTZ"]), // the case-fold rule (the DB's unique index is on lower(name))
      new Set(["quartz", "onyx", "basalt"]),
      new Set(AGENT_NAME_POOL), // the pool is spent — the suffix rounds start
      new Set([...AGENT_NAME_POOL, ...AGENT_NAME_POOL.map((n) => `${n}-2`)]),
      new Set(["nothing-from-the-pool"]),
    ];
    // Every single-handle-taken state, so no individual entry can differ between copies.
    for (const name of AGENT_NAME_POOL) cases.push(new Set([name]));
    return cases;
  }

  it("returns the same handle for every taken-set", () => {
    for (const taken of corpus()) {
      expect(desktop.pickAgentName(new Set(taken))).toBe(pickAgentName(new Set(taken)));
    }
  });

  it("agrees across a deep exhaustion run, pick for pick", () => {
    // Feeding each pick back in walks both implementations through three suffix rounds in
    // lockstep. A divergence in the round-sweeping rule shows up here and nowhere else.
    const web = new Set<string>();
    const main = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const a = pickAgentName(web);
      const b = desktop.pickAgentName(main);
      expect(b).toBe(a);
      web.add(a);
      main.add(b);
    }
    expect(main.size).toBe(200);
  });

  it("tolerates the shapes main really passes (a Set built from the ledger)", () => {
    // main/session-summary.js builds `taken` by walking its name ledger, so the values are
    // whatever it stored. Non-strings must not throw across the bridge into the engine.
    expect(desktop.pickAgentName(new Set([]))).toBe("quartz");
    expect(desktop.pickAgentName(new Set(["quartz"]))).toBe("onyx");
    expect(() => desktop.pickAgentName(new Set([undefined as unknown as string]))).not.toThrow();
  });
});
