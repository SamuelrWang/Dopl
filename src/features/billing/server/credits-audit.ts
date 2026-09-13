import "server-only";
import type { WalletKind } from "../credits";
import {
  getUserCreditsUsed,
  sumCreditLedger,
  sumMemberCreditsUsed,
} from "./credit-wallets";
import type { BillingTarget } from "./credits-service";

/**
 * THE RECONCILIATION GUARD — does one wallet's COUNTER equal its LEDGER?
 *
 * 🔒 **SAMUEL'S RULING, 2026-09-13: THE HISTOGRAM MUST EQUAL THE WALLET, ALWAYS**
 * ("there's a disconnect between the two charts. we need to nail this down").
 * `20261004120000_credit_consume_with_ledger.sql` makes divergence UNREACHABLE
 * going forward by putting both writes in one transaction. This file is the other
 * half of "always": a claim that two numbers agree is worth nothing if nobody can
 * MEASURE it, and the rows written before the fix — the three Samuel's wallet lost
 * to a `42703` on 2026-09-13, reconciled by hand — are exactly the rows no
 * transaction can vouch for retroactively.
 *
 * ⚠ **ITS OWN MODULE, NOT A THIRD RESPONSIBILITY FOR `credits-service.ts`**
 * (§1's "split, do not squeeze": that file measured 448 of the 500-line cap the
 * day this landed — ⚠ `wc -l`, do not quote). The seam is the one that file's own
 * header already draws: enforcement asks "may this call proceed", the meter asks
 * "how much is left", and this asks "do our two records of what was spent agree" —
 * a question with no place on the hottest write path in the product.
 *
 * ⚠ **NOTHING HERE DECIDES A CHARGE, GATES A CALL, OR CORRECTS A ROW.** It reads
 * two numbers and subtracts. Reconciliation is a person's decision with a person's
 * SQL (`scripts/sql/backfill-credit-wallets-v2.sql` sets counters FROM the
 * ledger); a service that silently rewrote either side would destroy the evidence
 * that they ever differed.
 */

/** Which wallet to reconcile, and the key its counter is on. */
export interface LedgerReconciliation {
  /** The COUNTER — the authority on what was charged. */
  counter: number;
  /** `SUM(amount)` over the ledger rows that counter's spends wrote. */
  ledgerSum: number;
  /**
   * `counter - ledgerSum`. **0 is the only correct value.**
   *
   * ⚠ **POSITIVE MEANS THE LEDGER IS MISSING ROWS** — the direction the old
   * fire-and-forget writer produced, and the one the /home card showed as a
   * histogram below its own bar. NEGATIVE means the ledger holds spend no counter
   * carries, which the atomic write cannot produce and a hand backfill can; both
   * are reported, neither is corrected.
   */
  drift: number;
}

/**
 * Compare one wallet's counter against its ledger for `periodStart`.
 *
 * ⚠ **BOTH SIDES KEY ON `(payer, wallet, period)`, AND THE SEAT ARM IS
 * CROSS-WORKSPACE FOR THAT REASON.** The ledger row records the ADDRESSED
 * container, never the charged one (`credit-ledger.ts › CreditUsageEvent`), so a
 * per-workspace ledger sum would drop every cross-container seat burn and report
 * the difference as drift. The counter side therefore sums the payer's seat rows
 * for the same period (`credit-wallets.ts › sumMemberCreditsUsed`) — an
 * apples-to-apples total, not a pooled allowance.
 *
 * ⚠ **THROWS.** The fail direction is the caller's: `ledgerDriftFor` below is the
 * one that decides a read failure is not worth a 500 on the billing surface.
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
 * ⚠ **DEGRADES TO 0, LOUDLY, AND THE REASON IS THE MIGRATION LAG** — the same
 * argument `home/server/repository-overview.ts › scanCreditEvents` makes for being
 * the one read on its page that degrades instead of throwing. `credit_ledger_sum`
 * ships as an UNAPPLIED migration (Samuel applies it), so between deploy and apply
 * the function DOES NOT EXIST: throwing here would 500 the billing surface for
 * every user over a figure that is a diagnostic, not a meter. **A warn, not an
 * error**: what was lost is a measurement, not a credit.
 *
 * ⚠ **0 MEANS "reconciled" TO EVERY CONSUMER, SO THE DEGRADE IS A FALSE
 * NEGATIVE BY CONSTRUCTION** — stated rather than discovered. The alternative is a
 * third state on the wire and a renderer that has to explain it; the honest
 * mitigation is the log line, which names the wallet it could not check.
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
