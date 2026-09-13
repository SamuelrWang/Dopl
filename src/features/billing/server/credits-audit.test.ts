/**
 * INVARIANT SUITE — **THE RECONCILIATION GUARD** (`credits-audit.ts`).
 *
 * 🔒 **SAMUEL'S RULING, 2026-09-13: THE HISTOGRAM MUST EQUAL THE WALLET, ALWAYS**
 * (*"there's a disconnect between the two charts. we need to nail this down"*;
 * F-693). `20261004120000_credit_consume_with_ledger.sql` makes the two AGREE by
 * construction for every row written after it. This module is the other half of
 * "always" — the measurement that says so, for the rows written before it and for
 * anything a hand backfill does afterwards.
 *
 * What is pinned:
 *   1. **BOTH SIDES ARE READ ON THE SAME KEY.** Personal: the payer's own counter
 *      against the payer's own `wallet='personal'` ledger sum. Seat: the payer's
 *      seat counters SUMMED across workspaces, against the `wallet='seat'` sum —
 *      because the ledger row records the ADDRESSED container, so a per-workspace
 *      narrowing would drop cross-container seat burns and report them as drift.
 *   2. **THE SIGN IS MEANINGFUL AND BOTH DIRECTIONS ARE REPORTED.** Positive = the
 *      ledger is missing rows (the old fire-and-forget writer's failure mode, and
 *      the shape of the incident). Negative = ledger rows no counter carries.
 *   3. **`ledgerDriftFor` DEGRADES TO 0 WITH A WARN, NEVER THROWS.** The migration
 *      ships unapplied, so `credit_ledger_sum` does not exist between deploy and
 *      apply; a 500 on the billing surface over a diagnostic is the wrong trade.
 *   4. **NOTHING IS CORRECTED.** No write, no counter touched — reconciliation is
 *      a person's SQL, and a service that rewrote either side would destroy the
 *      evidence that they differed.
 *
 * ⚠ The repository is mocked; the arithmetic and the degrade are the code under
 * test.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./credit-wallets", () => ({
  getUserCreditsUsed: vi.fn(),
  sumMemberCreditsUsed: vi.fn(),
  sumCreditLedger: vi.fn(),
}));

import * as wallets from "./credit-wallets";
import { ledgerDriftFor, walletMatchesLedger } from "./credits-audit";
import {
  personalTarget,
  seatTarget,
  unmeteredTarget,
} from "./credits-target-fixtures";

const mockWallets = vi.mocked(wallets);

const PAYER = "user-operator";
const WS = "ws-standard-1";
const PERIOD = "2026-09-01T00:00:00.000Z";

beforeEach(() => {
  vi.clearAllMocks();
  mockWallets.getUserCreditsUsed.mockResolvedValue(0);
  mockWallets.sumMemberCreditsUsed.mockResolvedValue(0);
  mockWallets.sumCreditLedger.mockResolvedValue(0);
});

describe("walletMatchesLedger — the PERSONAL wallet", () => {
  it("reports 0 drift when the counter and the ledger agree", async () => {
    mockWallets.getUserCreditsUsed.mockResolvedValue(8);
    mockWallets.sumCreditLedger.mockResolvedValue(8);
    expect(await walletMatchesLedger(PAYER, "personal", PERIOD)).toEqual({
      counter: 8,
      ledgerSum: 8,
      drift: 0,
    });
  });

  /**
   * 🔒 **THE INCIDENT, AS A CASE.** Samuel's counter read 8 over FIVE ledger rows
   * because three inserts answered `42703` after the counter had already moved and
   * were `console.warn`ed. This is the number the guard has to be able to say.
   */
  it("🔒 reports the incident's shape: counter 8, ledger 5, drift +3", async () => {
    mockWallets.getUserCreditsUsed.mockResolvedValue(8);
    mockWallets.sumCreditLedger.mockResolvedValue(5);
    expect(await walletMatchesLedger(PAYER, "personal", PERIOD)).toEqual({
      counter: 8,
      ledgerSum: 5,
      drift: 3,
    });
  });

  it("reports the OTHER direction too, rather than clamping at zero", async () => {
    // A hand backfill can leave ledger rows with no counter behind them. The
    // atomic RPC cannot produce this, which is exactly why it must be visible.
    mockWallets.getUserCreditsUsed.mockResolvedValue(4);
    mockWallets.sumCreditLedger.mockResolvedValue(6);
    expect((await walletMatchesLedger(PAYER, "personal", PERIOD)).drift).toBe(-2);
  });

  it("reads the payer's own counter and the payer's own ledger rows", async () => {
    await walletMatchesLedger(PAYER, "personal", PERIOD);
    expect(mockWallets.getUserCreditsUsed).toHaveBeenCalledWith(PAYER, PERIOD);
    expect(mockWallets.sumCreditLedger).toHaveBeenCalledWith(
      PAYER,
      "personal",
      PERIOD
    );
    // ⚠ THE REVERT DETECTOR FOR THE WRONG COUNTER: a version that read the seat
    // total for a personal wallet agrees with an empty ledger and disagrees with
    // everything else.
    expect(mockWallets.sumMemberCreditsUsed).not.toHaveBeenCalled();
  });
});

describe("walletMatchesLedger — the SEAT wallet", () => {
  /**
   * 🔒 **CROSS-WORKSPACE ON BOTH SIDES, AND IT IS NOT A POOL.** The ledger row
   * carries the ADDRESSED container, never the charged one, so the only key both
   * records share is `(payer, wallet, period)`. Narrowing the ledger by workspace
   * would drop every cross-container seat burn — rule B's arm 2 — and report the
   * difference as drift.
   */
  it("sums the payer's seats and compares against the seat ledger", async () => {
    mockWallets.sumMemberCreditsUsed.mockResolvedValue(12);
    mockWallets.sumCreditLedger.mockResolvedValue(12);
    expect(await walletMatchesLedger(PAYER, "seat", PERIOD)).toEqual({
      counter: 12,
      ledgerSum: 12,
      drift: 0,
    });
    expect(mockWallets.sumMemberCreditsUsed).toHaveBeenCalledWith(PAYER, PERIOD);
    expect(mockWallets.sumCreditLedger).toHaveBeenCalledWith(
      PAYER,
      "seat",
      PERIOD
    );
    expect(mockWallets.getUserCreditsUsed).not.toHaveBeenCalled();
  });

  it("🔒 never narrows either side by a workspace id", async () => {
    // ⚠ THE REVERT DETECTOR. `getMemberCreditsUsed(workspaceId, …)` is the METER's
    // read and is the obvious wrong fix here: one workspace's counter against a
    // cross-workspace ledger sum flags every person holding two seats.
    await walletMatchesLedger(PAYER, "seat", PERIOD);
    for (const call of [
      ...mockWallets.sumMemberCreditsUsed.mock.calls,
      ...mockWallets.sumCreditLedger.mock.calls,
    ]) {
      expect(call).not.toContain(WS);
    }
  });
});

describe("ledgerDriftFor — what the status payload publishes", () => {
  it("passes the resolved wallet and the METER's own period through", async () => {
    mockWallets.getUserCreditsUsed.mockResolvedValue(9);
    mockWallets.sumCreditLedger.mockResolvedValue(7);
    const drift = await ledgerDriftFor(
      personalTarget({ workspaceId: "ws-link-1", payerUserId: PAYER }),
      PERIOD
    );
    expect(drift).toBe(2);
    // ⚠ THE PERIOD IS THE METER'S, NOT THE CLOCK'S: a wallet on a Stripe anchor
    // does not roll on the 1st, and reconciling a different window would report
    // two different months as drift.
    expect(mockWallets.sumCreditLedger).toHaveBeenCalledWith(
      PAYER,
      "personal",
      PERIOD
    );
  });

  it("reads NOTHING for an unmetered target — zeroes have nothing to disagree with", async () => {
    expect(await ledgerDriftFor(unmeteredTarget("ws-link-1"), PERIOD)).toBe(0);
    expect(mockWallets.sumCreditLedger).not.toHaveBeenCalled();
    expect(mockWallets.getUserCreditsUsed).not.toHaveBeenCalled();
  });

  it("reads NOTHING when the meter measured no window", async () => {
    // The degraded fallback statuses carry blank period bounds; reconciling an
    // empty key would compare two coincidental zeroes and call it agreement.
    expect(
      await ledgerDriftFor(seatTarget({ workspaceId: WS, payerUserId: PAYER }), "")
    ).toBe(0);
    expect(mockWallets.sumCreditLedger).not.toHaveBeenCalled();
  });

  /**
   * 🔒 **THE MIGRATION LAG IS THE WHOLE REASON THIS DEGRADES.**
   * `credit_ledger_sum` ships as an UNAPPLIED migration, so between deploy and
   * apply the function does not exist. A throw here 500s `GET /api/billing/status`
   * — the single billing read every surface makes — over a diagnostic figure.
   */
  it("🔒 degrades to 0 with a WARN when the reconciliation cannot be read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockWallets.sumCreditLedger.mockRejectedValue(
      new Error("Could not find the function public.credit_ledger_sum")
    );
    const drift = await ledgerDriftFor(
      personalTarget({ workspaceId: "ws-link-1", payerUserId: PAYER }),
      PERIOD
    );
    expect(drift).toBe(0);
    // WARN, not ERROR, and it names what it could not check: a measurement was
    // lost, not a credit.
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]?.[0]);
    expect(line).toContain("personal");
    expect(line).toContain(PAYER);
    warn.mockRestore();
  });
});
