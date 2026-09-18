import "server-only";
import type { WalletKind } from "../credits";
import {
  getUserCreditsUsed,
  sumCreditLedger,
  sumMemberCreditsUsed,
} from "./credit-wallets";
import type { BillingTarget } from "./credits-service";

/**
 * The reconciliation guard — does one wallet's counter equal its ledger?
 *
 * 2026-09-13 ruling: the histogram must equal the wallet. The migration makes
 * divergence unreachable going forward by putting both writes in one transaction;
 * this file is the measurement for the rows written before it, which no transaction
 * can vouch for retroactively.
 *
 * Nothing here decides a charge, gates a call, or corrects a row — it reads two
 * numbers and subtracts. Reconciliation is a person's SQL
 * (`scripts/sql/backfill-credit-wallets-v2.sql`); a service that rewrote either
 * side would destroy the evidence that they differed.
 */

/** Which wallet to reconcile, and the key its counter is on. */
export interface LedgerReconciliation {
  /** The counter — the authority on what was charged. */
  counter: number;
  /** `SUM(amount)` over the ledger rows that counter's spends wrote. */
  ledgerSum: number;
  /**
   * `counter - ledgerSum`; 0 is the only correct value. Positive means the ledger
   * is missing rows; negative means it holds spend no counter carries, which the
   * atomic write cannot produce and a hand backfill can. Both are reported, neither
   * is corrected.
   */
  drift: number;
}

/**
 * Compare one wallet's counter against its ledger for `periodStart`.
 *
 * Both sides key on `(payer, wallet, period)`, which is why the seat arm is
 * cross-workspace: the ledger row records the ADDRESSED container
 * (`credit-ledger.ts › CreditUsageEvent`), so a per-workspace sum would drop every
 * cross-container seat burn and report the difference as drift. The counter side
 * sums the payer's seat rows for the period
 * (`credit-wallets.ts › sumMemberCreditsUsed`).
 *
 * Throws — the fail direction is the caller's, and `ledgerDriftFor` below is where
 * a read failure is decided not to be worth a 500.
 */
export async function walletMatchesLedger(
  payerUserId: string,
  wallet: WalletKind,
  periodStart: string
): Promise<LedgerReconciliation> {
  const [counter, ledgerSum] = await Promise.all([
    wallet === "personal"
      ? getUserCreditsUsed(payerUserId, periodStart)
      : sumMemberCreditsUsed(payerUserId, periodStart),
    sumCreditLedger(payerUserId, wallet, periodStart),
  ]);
  return { counter, ledgerSum, drift: counter - ledgerSum };
}

/**
 * The drift figure `GET /api/billing/status` publishes as `credits.ledgerDrift`,
 * or `0` when there was nothing to reconcile or nothing could be read.
 *
 * Degrades to 0 loudly because of the migration lag — the same argument
 * `home/server/repository-overview.ts › scanCreditEvents` makes: `credit_ledger_sum`
 * ships unapplied, so between deploy and apply the function does not exist and
 * throwing would 500 the billing surface over a diagnostic. A warn, not an error — what was
 * lost is a measurement, not a credit.
 *
 * 0 means "reconciled" to every consumer, so the degrade is a false negative by
 * construction; the alternative is a third state on the wire, and the mitigation is
 * the log line naming the wallet it could not check.
 */
export async function ledgerDriftFor(
  target: BillingTarget,
  periodStart: string
): Promise<number> {
  // No wallet resolved, or no window measured — `unmetered()`'s zeroes have
  // nothing to disagree with.
  if (target.wallet === null || !periodStart) return 0;
  try {
    const { drift } = await walletMatchesLedger(
      target.payerUserId,
      target.wallet,
      periodStart
    );
    return drift;
  } catch (err) {
    console.warn(
      `[credits] ledger reconciliation unavailable for ${target.wallet} wallet of ` +
        `user ${target.payerUserId}: ${
          err instanceof Error ? err.message : String(err)
        }`
    );
    return 0;
  }
}
