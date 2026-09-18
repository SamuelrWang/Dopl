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
 * What a wallet reads — the credit window, the degraded reading, and the meter.
 * Nothing here spends: `credits-service.ts` owns which wallet a burn lands on and
 * whether it may proceed; this owns the numbers a surface prints.
 *
 * The import runs one way at runtime: this module takes `credits-service` types
 * only (erased) and `credits-service.ts` imports `unmetered` and `creditPeriodFor`
 * from here, so there is no runtime cycle.
 */
/**
 * Credit window for a billing row (null row = calendar month). Seat wallets only:
 * the personal wallet reaches the same `resolveCreditPeriod` through
 * `./personal-wallet.ts › personalWalletTier`, which resolves verdict and window
 * together.
 *
 * `entitledPlan` is the verdict, not `billing.plan`: a free verdict ignores the
 * subscription anchor outright, which un-sticks a workspace canceled mid-period
 * (`../credits.ts › resolveCreditPeriod`). Enforcement and the settings meter must
 * pass the same verdict.
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
 * 2026-08-26 ruling: fail open. Refusing would brick a relationship on the strength
 * of the other party's billing — a guest would see "out of credits" for an
 * allowance that is not theirs and that they cannot buy. The honesty requirement is
 * that it is logged: `consumeMcpCredits` warns with the reason before returning this.
 *
 * The branch is nearly unreachable (a DB guard stops a workspace losing its last
 * active owner) and stays anyway, because a branch answering an impossible state
 * must not throw.
 *
 * `degraded: true`, `upgradeUrl: ""` and `upgradeCredits: 0` match the route's
 * `failOpen()` byte for byte: both answers mean "allowed, and these numbers mean
 * nothing", and a reader that recognises only one of them prints a made-up
 * `used: 0` as if it were measured. F-668 (2026-09-14) put `upgradeCredits` on the
 * same footing — the two upgrade fields are set and cleared together on every arm.
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
    upgradeCredits: 0,
    degraded: true,
  };
}


/**
 * Read-only meter for ONE wallet — the caller's own. Takes the resolved target
 * plus the billing row and member count rather than re-reading them, because
 * its one caller has just paid for those reads (`getWorkspaceEntitlements`
 * alone is three queries).
 *
 * On the personal arm `billing` is the PAYER's personal row, not the addressed
 * container's (2026-09-08): inside a link container the addressed container has no
 * billing row at all, and handing this its `null` would meter a Pro operator at the
 * free 500 while enforcement charged them against 5,000.
 * `status-service.ts › callerCredits` resolves it through
 * `personal-wallet.ts › readPersonalBilling`.
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
 * One definition, two callers (`summarizeCredits` and `status-service.ts`): two
 * hand-written copies are how one surface comes to omit the `degraded` stamp the
 * other reports.
 */
export function unmeteredSummary(): CreditsSummary {
  const { periodStart, periodEnd, wallet, used, limit, remaining, degraded } =
    unmetered();
  return { periodStart, periodEnd, wallet, used, limit, remaining, degraded };
}

/** A `CreditConsumeResult` whose counters were never measured. */
export type UnmeteredResult = CreditConsumeResult & { degraded: true };
