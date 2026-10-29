/**
 * Usage reads against a recording fake: 🔒 only `dev_billable_events` is read (never `dev_events`),
 * every count is fenced by the caller's project ids and env and bounded to its bucket, and an empty
 * id list reads nothing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { table: string; ops: Array<[string, ...unknown[]]> };
const calls: Call[] = [];

function query(table: string) {
  const call: Call = { table, ops: [] };
  calls.push(call);
  const chain: Record<string, unknown> = {};
  for (const op of ["select", "in", "eq", "gte", "lt", "neq"]) {
    chain[op] = (...args: unknown[]) => {
      call.ops.push([op, ...args]);
      return chain;
    };
  }
  // 5 calls in every bucket, 1 of them failed.
  chain.then = (resolve: (v: unknown) => unknown) =>
    resolve({ data: null, count: call.ops.some((o) => o[0] === "neq") ? 1 : 5, error: null });
  return chain;
}

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: () => ({ from: (t: string) => query(t) }) }));

import { readUsage } from "./usage";

const NOW = new Date("2026-10-28T14:37:12.000Z");

beforeEach(() => {
  calls.length = 0;
});

describe("readUsage", () => {
  it("🔒 reads dev_billable_events only, fenced and bucketed", async () => {
    const u = await readUsage({ projectIds: ["p1", "p2"], env: "live", range: "7d", now: NOW });
    expect(new Set(calls.map((c) => c.table))).toEqual(new Set(["dev_billable_events"]));
    expect(calls).toHaveLength(14);
    for (const c of calls) {
      expect(c.ops).toContainEqual(["in", "project_id", ["p1", "p2"]]);
      expect(c.ops).toContainEqual(["eq", "env", "live"]);
      expect(c.ops.some((o) => o[0] === "gte")).toBe(true);
      expect(c.ops.some((o) => o[0] === "lt")).toBe(true);
    }
    expect(u).toMatchObject({ calls: 35, failed: 7, successRate: 0.8 });
    expect(u.points[6]).toMatchObject({ startIso: "2026-10-28T00:00:00.000Z", calls: 5, failed: 1 });
  });

  it("an empty id list reads nothing", async () => {
    const u = await readUsage({ projectIds: [], env: "test", range: "24h", now: NOW });
    expect(calls).toEqual([]);
    expect(u.points).toHaveLength(24);
    expect(u.calls).toBe(0);
  });
});
