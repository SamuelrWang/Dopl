/**
 * Invariant suite — the reconciliation guard (`credits-audit.ts`). F-693
 * (2026-09-13): the histogram must equal the wallet. The migration makes the two
 * agree by construction for new rows; this module measures the older ones and
 * anything a hand backfill leaves behind. Repository mocked.
 *
 * Pinned: both sides read on the same `(payer, wallet, period)` key (never narrowed
 * by workspace, since the ledger row records the ADDRESSED container); drift is
 * signed and both directions are reported; `ledgerDriftFor` degrades to 0 with a
 * warn rather than throwing; nothing is corrected — a service that rewrote either
 * side would destroy the evidence that they differed.
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
  homeSpaceTarget,
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
   * The incident as a case: a counter read 8 over five ledger rows because three
   * inserts answered `42703` after the counter had moved and were only warned about.
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
    // Revert detector: a version reading the seat total for a personal wallet
    // agrees with an empty ledger and disagrees with everything else.
    expect(mockWallets.sumMemberCreditsUsed).not.toHaveBeenCalled();
  });
});

describe("walletMatchesLedger — the SEAT wallet", () => {
  /**
   * Cross-workspace on both sides, and not a pool: the ledger row carries the
   * ADDRESSED container, so the only key both records share is
   * `(payer, wallet, period)`.
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
    // Revert detector: `getMemberCreditsUsed(workspaceId, …)` is the meter's read,
    // and one workspace's counter against a cross-workspace ledger sum flags every
    // person holding two seats.
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
      homeSpaceTarget({ workspaceId: "ws-link-1", payerUserId: PAYER }),
      PERIOD
    );
    expect(drift).toBe(2);
    // The period is the meter's, not the clock's: a wallet on a Stripe anchor does
    // not roll on the 1st, and a different window reads as drift.
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
   * Migration lag is why this degrades: `credit_ledger_sum` ships unapplied, so
   * between deploy and apply a throw here would 500 `GET /api/billing/status` over
   * a diagnostic figure.
   */
  it("🔒 degrades to 0 with a WARN when the reconciliation cannot be read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockWallets.sumCreditLedger.mockRejectedValue(
      new Error("Could not find the function public.credit_ledger_sum")
    );
    const drift = await ledgerDriftFor(
      homeSpaceTarget({ workspaceId: "ws-link-1", payerUserId: PAYER }),
      PERIOD
    );
    expect(drift).toBe(0);
    // Warn, not error, and it names what it could not check: a measurement was
    // lost, not a credit.
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]?.[0]);
    expect(line).toContain("personal");
    expect(line).toContain(PAYER);
    warn.mockRestore();
  });
});
