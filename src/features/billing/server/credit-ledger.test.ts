/**
 * INVARIANT SUITE — THE CREDIT LEDGER'S WRITER (`credit-ledger.ts`).
 *
 * 🔒 **THE COLUMN MAPPING IS THE WHOLE TEST, AND IT WAS UNPINNED UNTIL
 * 2026-09-07.** `recordCreditUsageEvent` swallows every error by design, so a
 * column the insert forgets is not an exception, not a log line and not a failed
 * request — it is a ledger that quietly stops answering the question it exists
 * for. `20260930120000_credit_wallets.sql` §4 added `wallet` and
 * `payer_user_id`; dropping either from the insert leaves "whose credits went
 * where" unanswerable while every other suite in this feature stays green.
 * (Measured: with no case here, deleting both keys from the insert broke
 * nothing.)
 *
 * ⚠ **AND THE SWALLOW IS PINNED TOO, IN BOTH DIRECTIONS.** It runs after the
 * spend is already committed on the hottest write path in the product, so a
 * failure here must never turn a successful, already-charged call into an error
 * the agent sees — and it must never be silent either, or a broken ledger looks
 * exactly like a quiet month.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const insert = vi.hoisted(() => vi.fn());

vi.mock("@/shared/supabase/admin", () => ({
  supabaseAdmin: () => ({ from: () => ({ insert }) }),
}));

import { recordCreditUsageEvent, type CreditUsageEvent } from "./credit-ledger";

const CONTAINER = "ws-link-1";
const CALLER = "user-guest";
const OWNER = "user-operator";

/** A guest's burn in somebody's link container — the one shape where the caller
 *  and the payer differ, and therefore the shape worth defaulting to. */
function event(over: Partial<CreditUsageEvent> = {}): CreditUsageEvent {
  return {
    workspaceId: CONTAINER,
    originWorkspaceId: CONTAINER,
    userId: CALLER,
    channelId: null,
    wallet: "personal",
    payerUserId: OWNER,
    amount: 1,
    periodStart: "2026-09-01T00:00:00.000Z",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  insert.mockResolvedValue({ error: null });
});

describe("the row it writes", () => {
  it("🔒 carries the WALLET and the PAYER, not only the caller", async () => {
    await recordCreditUsageEvent(event());
    expect(insert).toHaveBeenCalledWith({
      workspace_id: CONTAINER,
      origin_workspace_id: CONTAINER,
      user_id: CALLER,
      channel_id: null,
      wallet: "personal",
      payer_user_id: OWNER,
      amount: 1,
      period_start: "2026-09-01T00:00:00.000Z",
    });
  });

  it("🔒 keeps the caller and the payer as SEPARATE columns", async () => {
    // Collapsing them makes "who spent my credits" answer the wrong person on
    // every guest burn — and answer it confidently.
    await recordCreditUsageEvent(event());
    const row = insert.mock.calls[0]?.[0];
    expect(row.user_id).toBe(CALLER);
    expect(row.payer_user_id).toBe(OWNER);
  });

  it("names the SEAT wallet on a workspace burn, where the two coincide", async () => {
    await recordCreditUsageEvent(
      event({ wallet: "seat", userId: CALLER, payerUserId: CALLER })
    );
    expect(insert.mock.calls[0]?.[0]).toMatchObject({
      wallet: "seat",
      user_id: CALLER,
      payer_user_id: CALLER,
    });
  });

  it("stamps the period key it was GIVEN, never one derived from the clock", async () => {
    // A paid workspace's period is anchored to its subscription date, so a
    // re-derived `created_at` month files the row under a window the counter
    // never used.
    await recordCreditUsageEvent(event({ periodStart: "2026-07-21T09:30:00.000Z" }));
    expect(insert.mock.calls[0]?.[0].period_start).toBe("2026-07-21T09:30:00.000Z");
  });
});

describe("it is fire-and-forget, and that is a decision with a stated cost", () => {
  it("never throws when the insert errors — the spend already committed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    insert.mockResolvedValue({ error: new Error("relation does not exist") });

    await expect(recordCreditUsageEvent(event())).resolves.toBeUndefined();
    // ⚠ WARN, NOT SILENCE. A dropped attribution row is a known, accepted loss;
    // an invisible one is indistinguishable from a month with no traffic.
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("never throws when the client itself throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    insert.mockRejectedValue(new Error("connection reset"));
    await expect(recordCreditUsageEvent(event())).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("🔒 writes NOTHING for a non-positive amount", async () => {
    // The caller gates on `allowed`; this is the second half of that rule. The
    // table's own CHECK would reject it, turning a swallowed no-op into a
    // swallowed ERROR that looks identical in the logs.
    await recordCreditUsageEvent(event({ amount: 0 }));
    await recordCreditUsageEvent(event({ amount: -1 }));
    expect(insert).not.toHaveBeenCalled();
  });
});
