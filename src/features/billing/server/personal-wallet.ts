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
 * WHAT TIER A PERSONAL WALLET IS ON, AND WHICH WINDOW IT SPENDS IN.
 *
 * 🔒 **SPLIT OUT OF `credits-service.ts` ON 2026-09-08, AND THE SEAM IS REAL**
 * (§1: "split, do not squeeze" — that file was 416 lines and the personal Pro
 * tier adds ~80). `credits-service.ts` answers WHICH WALLET a burn lands on and
 * WHOSE it is; this answers WHAT THAT WALLET IS ENTITLED TO, which before this
 * wave was not a question at all — the personal allowance was one constant with
 * no row behind it (`credits.ts › PERSONAL_MONTHLY_CREDITS`, then a bare 500).
 *
 * 🔒 **THE PERSONAL CONTAINER IS THE BILLING ROW (Samuel, 2026-09-08; spec
 * §11.1).** A `kind='personal'` container is a real `workspaces` row, so its Pro
 * subscription lives in `workspace_billing` keyed by that container id — same
 * table, same webhook, same watermark, same portal. There is no second Stripe
 * pipeline and no `user_billing` table: what looks like "the user's plan" is
 * always a row on their own container.
 */

/**
 * The billing row that decides a personal wallet's tier — ONE round trip on
 * either path.
 *
 * ⚠ **WHICH READ DEPENDS ON WHAT WAS ADDRESSED, AND SKIPPING THE LOOKUP IS THE
 * WHOLE OPTIMISATION.** When the caller addressed their OWN personal container,
 * that container IS the row we want, so `getWorkspaceBilling(containerId)`
 * answers directly and the owner → container hop never happens. When they
 * addressed a `kind='link'` container (a home channel), the payer is its OWNER
 * and their personal container is somewhere else, so `getPersonalBilling` makes
 * the hop — as one embedded query, not two (`workspace-billing.ts ›
 * getPersonalBilling`).
 *
 * ⚠ **PASS `addressedPersonalContainerId` ONLY FOR `kind='personal'`.** Handing
 * it a link container's id reads a row that does not exist and reports every
 * Pro operator as free — silently, because a missing row is a legitimate answer
 * here (a free home space).
 *
 * ⚠ **A PAYER WITH NO PERSONAL CONTAINER IS FREE, AND IT IS LOGGED.**
 * `20260920120000_workspace_kind_personal.sql` backfilled one per user and
 * `ensure_personal_container` mints one on demand, so `null` is the answer to a
 * state the database says cannot exist — and the burn still has to be charged
 * to SOMETHING. It falls to the free tier (the safe direction: a wrong `pro`
 * would hand out 5,000 credits nobody paid for) and warns, because a silent
 * free-tier fallback for a paying customer is exactly the failure that has no
 * user-visible symptom until the refusal lands.
 */
export async function readPersonalBilling(
  payerUserId: string,
  addressedPersonalContainerId: string | null
): Promise<WorkspaceBillingRow | null> {
  if (addressedPersonalContainerId) {
    return getWorkspaceBilling(addressedPersonalContainerId);
  }
  const personal = await getPersonalBilling(payerUserId);
  if (!personal) {
    console.warn(
      `[credits] user ${payerUserId} has no kind='personal' container; ` +
        `charging their personal wallet at the FREE tier on the calendar month. ` +
        `Every user should have one since 20260920120000_workspace_kind_personal.sql.`
    );
    return null;
  }
  return personal.billing;
}

/** A personal wallet's tier: the verdict, what it allows, and when it rolls. */
export interface PersonalWalletTier extends CreditPeriod {
  /** The ENTITLEMENT verdict — `pro` or `free` on a personal container. */
  verdict: PlanId;
  limit: number;
}

/**
 * Verdict → allowance → window, from a row the caller already read.
 *
 * ⚠ **`memberCount` IS HARDCODED 1, AND IT IS A FACT RATHER THAN AN
 * ASSUMPTION.** A `kind='personal'` container holds its owner and nobody else
 * (`entitlements.ts › assertCanAddMember` refuses the second), so counting
 * members would buy a round trip to learn a constant. It matters only to the
 * `solo` arm of `paidEntitlement`, and `solo` is a standard-workspace plan that
 * cannot be on this row.
 *
 * ⚠ **THE WINDOW IS `resolveCreditPeriod`, NOT `personalCreditPeriod`, SINCE
 * 2026-09-08.** A Pro wallet has a subscription and therefore a billing date;
 * charging its spend to the calendar month while Stripe renews on the 21st
 * would hand the payer a second month's allowance ten days early, every month.
 * The FREE arm still lands on the calendar month, because
 * `resolveCreditPeriod` ignores the anchor on a free verdict — which is also
 * the self-heal for a CANCELED Pro row (a dead anchor pointing at a key already
 * spent to 5,000, against a fresh 500 limit, is a lockout).
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
