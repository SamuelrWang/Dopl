/**
 * 🔒 **`memberCounts` BOTH ARMS: THE EXACT RPC, AND THE WALK WHEN IT IS ABSENT**
 * (cleanup C13, branch cleanup/c13-tally; migration
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
 */

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
