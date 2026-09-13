import "server-only";
import {
  personalCreditPeriod,
  resolveCreditPeriod,
  seatCreditsForPlan,
  type CreditPeriod,
} from "../credits";
import type { PlanId } from "../plans";
import { getMemberCreditsUsed, getUserCreditsUsed } from "./credit-wallets";
import type {
  BillingTarget,
  CreditConsumeResult,
  CreditsSummary,
} from "./credits-service";
import { entitledPlanFor } from "./entitlements";
import { personalWalletTier } from "./personal-wallet";
import type { WorkspaceBillingRow } from "./workspace-billing";

/**
 * WHAT A WALLET READS — the credit WINDOW, the DEGRADED reading, and the METER.
 * Nothing here spends: `credits-service.ts` owns WHICH wallet a burn lands on and
 * whether it may proceed, and this owns the numbers a surface prints.
 *
 * ⚠ **SPLIT OUT OF `credits-service.ts` ON 2026-09-13, WHEN RULE B NEEDED THE
 * ROOM** (§1's "split, do not squeeze": that file measured 490 of the 500-line cap
 * the day rule B landed — ⚠ `wc -l`, do not quote). The seam is real and it is
 * the one that file's own header describes: enforcement asks "may this call
 * proceed", a surface asks "how much is left", and only the first is on the
 * hottest write path in the product.
 *
 * ⚠ **THE IMPORT RUNS ONE WAY AT RUNTIME.** This module imports `credits-service`
 * TYPES ONLY (erased), and `credits-service.ts` imports `unmetered` and
 * `creditPeriodFor` from here — so there is no runtime cycle, and the direction
 * says which file is upstream.
 */
/**
 * Credit window for a billing row (null row = calendar month). SEAT wallets
 * only — not because the rule differs, but because the personal wallet reaches
 * the SAME `resolveCreditPeriod` through `./personal-wallet.ts ›
 * personalWalletTier`, which resolves its verdict and its window together.
 * ⚠ THE SUPERSEDED LINE SAID "a personal wallet has no subscription to anchor
 * to" — true only while that wallet had one tier (2026-09-07). A `pro` wallet
 * has a Stripe anchor and uses it.
 *
 * ⚠ `entitledPlan` is the VERDICT, not `billing.plan`: a free verdict ignores
 * the subscription anchor outright, which un-sticks a workspace canceled
 * mid-period (`../credits.ts › resolveCreditPeriod`). Both callers —
 * enforcement and the settings meter — must pass the SAME verdict.
 */
export function creditPeriodFor(
  billing: WorkspaceBillingRow | null,
  entitledPlan: PlanId
): CreditPeriod {
  return resolveCreditPeriod(
    {
      currentPeriodStart: billing?.currentPeriodStart ?? null,
      currentPeriodEnd: billing?.currentPeriodEnd ?? null,
    },
    entitledPlan
  );
}

/**
 * A burn with no wallet to charge: a container with no active owner row.
 *
 * ⚠ FAIL OPEN, AND IT IS A RULING RATHER THAN AN OVERSIGHT (Samuel, 2026-08-26,
 * on lowering the consume floor): refusing would brick a relationship on the
 * strength of the OTHER party's billing — a guest doing legitimate work in a
 * channel they were invited into would see "out of credits" for an allowance
 * that is not theirs and that they cannot buy. The honesty requirement is that
 * it is LOGGED, not silent: `consumeMcpCredits` warns with the reason before
 * returning this. Zeroed counters, because nothing was measured.
 *
 * ⚠ **THE BRANCH IS NEARLY UNREACHABLE AND STAYS ANYWAY.**
 * `20260720184806_workspace_last_active_owner_guard.sql` stops a workspace
 * losing its last active owner, so this is the answer to a state the database
 * says cannot exist — which is exactly the kind of branch that must not throw.
 *
 * ⚠ `degraded: true` IS THE SAME STAMP THE ROUTE'S `failOpen()` PUTS ON ITS
 * OWN ZEROES, and it must be: both answers are "allowed, and these numbers mean
 * nothing", and a reader that can only recognise one of them puts a made-up
 * `used: 0` on the settings meter as if it were measured.
 *
 * ⚠ `upgradeUrl` IS EMPTY, MATCHING `failOpen()` BYTE FOR BYTE (2026-09-07). It
 * carried the billing link until this wave, which pointed a caller at a
 * checkout for a refusal that never happened — and the two degraded answers
 * differing at all is what makes one reader treat them differently.
 */
export function unmetered(): UnmeteredResult {
  return {
    ...personalCreditPeriod(),
    wallet: null,
    allowed: true,
    used: 0,
    limit: 0,
    remaining: 0,
    upgradeUrl: "",
    degraded: true,
  };
}


/**
 * Read-only meter for ONE wallet — the caller's own. Takes the resolved target
 * plus the billing row and member count rather than re-reading them, because
 * its one caller has just paid for those reads (`getWorkspaceEntitlements`
 * alone is three queries).
 *
 * ⚠ **ON THE PERSONAL ARM `billing` IS THE PAYER'S PERSONAL ROW, NOT THE
 * ADDRESSED CONTAINER'S** (2026-09-08). Those are the same row when the caller
 * addressed their own personal container and DIFFERENT rows inside a link
 * container, where the addressed container has no billing row at all. Handing
 * this the link container's `null` would meter every Pro operator's home space
 * at the free 500 while enforcement charged them against 5,000 — a meter that
 * cannot explain the refusal, which is the exact failure the "same verdict on
 * both sides" rule exists to prevent. `status-service.ts › callerCredits`
 * resolves it through `personal-wallet.ts › readPersonalBilling`.
 */
export async function summarizeCredits(
  target: BillingTarget,
  billing: WorkspaceBillingRow | null,
  memberCount: number
): Promise<CreditsSummary> {
  if (target.wallet === null) return unmeteredSummary();
  if (target.wallet === "personal") {
    const tier = personalWalletTier(billing);
    const used = await getUserCreditsUsed(target.payerUserId, tier.periodStart);
    return {
      periodStart: tier.periodStart,
      periodEnd: tier.periodEnd,
      wallet: "personal",
      used,
      limit: tier.limit,
      remaining: Math.max(0, tier.limit - used),
    };
  }
  const plan = entitledPlanFor(billing, memberCount);
  const period = creditPeriodFor(billing, plan);
  const limit = seatCreditsForPlan(plan);
  const used = await getMemberCreditsUsed(
    target.workspaceId,
    target.payerUserId,
    period.periodStart
  );
  return {
    ...period,
    wallet: "seat",
    used,
    limit,
    remaining: Math.max(0, limit - used),
  };
}

/**
 * `unmetered()` narrowed to the METER's fields — the same zeroes, minus the
 * consume decision.
 *
 * ⚠ ONE DEFINITION, TWO CALLERS (`summarizeCredits` and `status-service.ts`).
 * Two hand-written copies of "the degraded reading" is how one surface comes to
 * report a `degraded` stamp the other omits, and the whole point of the stamp is
 * that one reader recognises every degraded answer.
 */
export function unmeteredSummary(): CreditsSummary {
  const { periodStart, periodEnd, wallet, used, limit, remaining, degraded } =
    unmetered();
  return { periodStart, periodEnd, wallet, used, limit, remaining, degraded };
}

/** A `CreditConsumeResult` whose counters were never measured. */
export type UnmeteredResult = CreditConsumeResult & { degraded: true };
