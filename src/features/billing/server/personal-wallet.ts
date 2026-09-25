import "server-only";
import {
  personalCreditsForPlan,
  resolveCreditPeriod,
  type CreditPeriod,
} from "../credits";
import type { PlanId } from "../plans";
import { entitledPlanFor } from "./entitlements";
import {
  getPersonalBilling,
  getWorkspaceBilling,
  type WorkspaceBillingRow,
} from "./workspace-billing";

/**
 * What tier a personal wallet is on, and which window it spends in.
 * `credits-service.ts` answers which wallet a burn lands on and whose it is; this
 * answers what that wallet is entitled to — which before the Pro tier was one
 * constant with no row behind it (`credits.ts › PERSONAL_MONTHLY_CREDITS`).
 *
 * 2026-09-08: the home space IS the billing row. A `kind='home'`
 * container is a real `workspaces` row, so its Pro subscription lives in
 * `workspace_billing` keyed by that container id — same table, webhook, watermark
 * and portal. There is no second Stripe pipeline and no `user_billing` table.
 */

/**
 * The billing row that decides a personal wallet's tier — ONE round trip on
 * either path.
 *
 * Which read depends on what was addressed. A caller who addressed their own
 * home space IS the row we want, so `getWorkspaceBilling(containerId)`
 * answers directly and the owner → container hop never happens; from a
 * `kind='link'` container the payer is its owner, so
 * `workspace-billing.ts › getPersonalBilling` makes the hop as one embedded query.
 *
 * Pass `addressedHomeSpaceId` only for `kind='home'`: a link
 * container's id reads a row that does not exist and reports every Pro operator as
 * free, silently, because a missing row is a legitimate answer here.
 *
 * A payer with no home space falls to the free tier and warns. That is the
 * safe direction (a wrong `pro` hands out 5,000 credits nobody paid for), and the
 * warn is there because a silent free-tier fallback for a paying customer has no
 * visible symptom until the refusal lands.
 */
export async function readPersonalBilling(
  payerUserId: string,
  addressedHomeSpaceId: string | null
): Promise<WorkspaceBillingRow | null> {
  if (addressedHomeSpaceId) {
    return getWorkspaceBilling(addressedHomeSpaceId);
  }
  const personal = await getPersonalBilling(payerUserId);
  if (!personal) {
    console.warn(
      `[credits] user ${payerUserId} has no kind='home' container; ` +
        `charging their personal wallet at the FREE tier on the calendar month. ` +
        `Every user should have one since 20260920120000_workspace_kind_personal.sql.`
    );
    return null;
  }
  return personal.billing;
}

/** A personal wallet's tier: the verdict, what it allows, and when it rolls. */
export interface PersonalWalletTier extends CreditPeriod {
  /** The entitlement verdict — `pro` or `free` on a home space. */
  verdict: PlanId;
  limit: number;
}

/**
 * Verdict → allowance → window, from a row the caller already read.
 *
 * `memberCount` is hardcoded 1 as a fact, not an assumption: a `kind='home'`
 * container holds its owner and nobody else (`entitlements.ts › assertCanAddMember`
 * refuses the second), so counting would buy a round trip to learn a constant.
 *
 * The window is `resolveCreditPeriod`, not `personalCreditPeriod` (2026-09-08): a
 * Pro wallet has a billing date, and charging its spend to the calendar month while
 * Stripe renews on the 21st hands the payer a second month's allowance ten days
 * early. The free arm still lands on the calendar month, since `resolveCreditPeriod`
 * ignores the anchor on a free verdict — which also self-heals a canceled Pro row,
 * whose dead anchor would otherwise lock the caller out.
 */
export function personalWalletTier(
  billing: WorkspaceBillingRow | null
): PersonalWalletTier {
  const verdict = entitledPlanFor(billing, 1);
  return {
    verdict,
    limit: personalCreditsForPlan(verdict),
    ...resolveCreditPeriod(
      {
        currentPeriodStart: billing?.currentPeriodStart ?? null,
        currentPeriodEnd: billing?.currentPeriodEnd ?? null,
      },
      verdict
    ),
  };
}
