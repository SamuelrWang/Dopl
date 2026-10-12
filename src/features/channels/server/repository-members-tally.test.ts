/**
 * 🔒 **`memberCounts` BOTH ARMS: THE EXACT RPC, AND THE WALK WHEN IT IS ABSENT**
 * (cleanup C13, branch fix/c13-tally-r; migration
 * `20261121120000_channel_member_tally_rpc.sql`).
 *
 * The RPC answers first and exactly, never `truncated`. When the function is not
 * there (PGRST202 / 42883: the migration is written, not applied) the read must
 * still answer, through the paged walk with its `truncated` carried. Any other
 * RPC error throws. The walk's own ceiling cases stay in
 * `repository-members-rowcap.test.ts`, where the fake's default (no RPC
 * registered → PGRST202) already drives them down the fallback arm.
 *
 * MUTATION-VERIFY (each alone turns the named case red):
 *  - skip the RPC (`const exact = null`) → "exact arm" fails.
 *  - drop "42883" from RPC_MISSING_CODES → "42883 degrades" fails.
 *  - return `null` on every error → "any other error throws" fails.
 *  - clip the exact arm as truncated → "exact arm" fails.
 *  - ADD "42P01" to RPC_MISSING_CODES → "42P01 … THROWS" and the membership
 *    assertion both fail (Review 28: this WIDENING survived every case above).
 *  - seed an explicit 0 for every requested id → "no members → NO KEY" fails on
 *    both arms (Review 28: this also survived).
 *
 * ⚠ TWO HALVES, DELIBERATELY. The behavioural cases carry the SEMANTICS (this
 * code degrades, that code throws); a source assertion carries EXHAUSTIVENESS,
 * because `RPC_MISSING_CODES` is module-local and a behavioural test cannot
 * enumerate the codes that are NOT in it. The slice fails closed: no match is a
 * thrown assertion, never a silent pass (Brief § gate scripts must fail closed).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import { fakePostgrest, type Row } from "@/shared/testing/postgrest-cap";
import { memberCounts } from "./repository-members";

const CH = "22222222-3333-4444-8555-666666666666";
const CH_B = "22222222-3333-4444-8555-666666666777";

function members(n: number, channel = CH): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    channel_id: channel,
    user_id: `u-${String(i).padStart(7, "0")}`,
  }));
}

function mount(rows: Row[], rpc?: Parameters<typeof fakePostgrest>[1]) {
  const fake = fakePostgrest({ channel_members: rows }, rpc);
  vi.mocked(supabaseAdmin).mockReturnValue(fake.client as never);
  return fake;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("memberCounts — the exact RPC arm", () => {
  it("exact arm: answers the RPC's counts, untruncated, and reads no table page", async () => {
    // 12,000 rows would clip the walk at its 10,000 cap; the RPC is not clipped.
    const fake = mount(members(5), {
      rpc: (name) =>
        name === "channel_member_tally"
          ? {
              data: [
                { channel_id: CH, member_count: 12_000 },
                { channel_id: CH_B, member_count: "3" },
              ],
              error: null,
            }
          : undefined,
    });
    const counts = await memberCounts([CH, CH_B]);
    expect(counts.get(CH)).toBe(12_000);
    expect(counts.get(CH_B), "bigint as a JSON string still reads as a number").toBe(3);
    expect(counts.truncated).toBe(false);
    expect(fake.pageReads(), "no walk when the RPC answers").toBe(0);
    const call = fake.calls.find((c) => c.op === "rpc");
    expect(call?.args).toEqual(["channel_member_tally", { p_channel_ids: [CH, CH_B] }]);
  });

  it("no ids: answers an empty, untruncated map without calling anything", async () => {
    const fake = mount([]);
    const counts = await memberCounts([]);
    expect(counts.size).toBe(0);
    expect(counts.truncated).toBe(false);
    expect(fake.calls).toEqual([]);
  });
});

describe("memberCounts — the RPC is absent: degrade to the walk", () => {
  it("PGRST202 degrades: the walk counts, its truncated carried", async () => {
    const fake = mount(members(1_500)); // no rpc registered → PGRST202
    const counts = await memberCounts([CH]);
    expect(counts.get(CH)).toBe(1_500);
    expect(counts.truncated).toBe(false);
    expect(fake.pageReads(), "the walk ran").toBeGreaterThan(1);
  });

  it("42883 degrades the same way", async () => {
    mount(members(7), {
      rpc: () => ({ data: null, error: { code: "42883", message: "function does not exist" } }),
    });
    const counts = await memberCounts([CH]);
    expect(counts.get(CH)).toBe(7);
  });

  it("any other RPC error throws rather than silently walking", async () => {
    mount(members(7), {
      rpc: () => ({ data: null, error: { code: "57014", message: "statement timeout" } }),
    });
    await expect(memberCounts([CH])).rejects.toMatchObject({ code: "57014" });
  });
});

describe("memberCounts — WHICH codes degrade, and only those", () => {
  /**
   * 🔒 **THE DEGRADE SET IS A WHITELIST OF TWO, NOT A "SOMETHING IS MISSING" NET**
   * (Review 28). `42P01` is undefined_table: the FUNCTION exists and its body
   * cannot see `channel_members`. Degrading on that would answer a silent, wrong
   * count — a short number with `truncated` false — where throwing surfaces a
   * broken grant or a dropped table. Only "the migration is not applied yet"
   * (PGRST202 from PostgREST, 42883 from Postgres) may fall back.
   */
  it("42P01 (undefined_table) THROWS — a missing TABLE is not a missing FUNCTION", async () => {
    mount(members(7), {
      rpc: () => ({ data: null, error: { code: "42P01", message: 'relation "channel_members" does not exist' } }),
    });
    await expect(memberCounts([CH])).rejects.toMatchObject({ code: "42P01" });
  });

  it("RPC_MISSING_CODES holds EXACTLY PGRST202 and 42883 — nothing else degrades", () => {
    const src = readFileSync(join(import.meta.dirname, "repository-members.ts"), "utf8");
    const decl = /const RPC_MISSING_CODES = new Set\(\[([^\]]*)\]\)/.exec(src);
    // ⚠ CONTROL: a renamed or reshaped declaration must FAIL here, not pass by
    // matching nothing. The behavioural cases above and below cover the two
    // members and one non-member; this is the only thing that can see a THIRD.
    expect(decl, "RPC_MISSING_CODES must be declared as `new Set([...])`").not.toBeNull();
    const codes = [...(decl as RegExpExecArray)[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(codes.slice().sort()).toEqual(["42883", "PGRST202"]);
  });
});

describe("memberCounts — a channel with no members has NO KEY, on BOTH arms", () => {
  /**
   * 🔒 **NO ROW, NO KEY — NOT A ZERO** (Review 28; the migration header states it).
   * The RPC `GROUP BY`s, so a memberless channel returns no row; the walk sets a
   * key per row, so it produces none either. Callers read `Map.get` and must see
   * `undefined` from both arms. A seeded `0` would be indistinguishable from a
   * real count to `get`, and that is why presence is asserted with `has`, never
   * with truthiness: `0` is falsy and would pass a truthiness check.
   */
  it("RPC path: a requested channel the RPC omits is absent from the map", async () => {
    // ⚠ The RPC answers for CH only, while BOTH ids are requested: a response that
    // covered every id would pass whether or not the code seeds absent ids.
    mount(members(5), {
      rpc: (name) =>
        name === "channel_member_tally"
          ? { data: [{ channel_id: CH, member_count: 5 }], error: null }
          : undefined,
    });
    const counts = await memberCounts([CH, CH_B]);
    expect(counts.has(CH_B), "no row for CH_B, so no key for CH_B").toBe(false);
    expect(counts.get(CH_B)).toBeUndefined();
    expect(counts.get(CH)).toBe(5);
    expect(counts.size, "exactly one key, for the one channel that had rows").toBe(1);
  });

  it("walk path: the fallback arm is absent for the same channel, identically", async () => {
    // No rpc registered → PGRST202 → the walk; rows exist for CH only.
    mount(members(5));
    const counts = await memberCounts([CH, CH_B]);
    expect(counts.has(CH_B), "the walk sets a key per ROW, so none for CH_B").toBe(false);
    expect(counts.get(CH_B)).toBeUndefined();
    expect(counts.get(CH)).toBe(5);
    expect(counts.size).toBe(1);
  });
});
