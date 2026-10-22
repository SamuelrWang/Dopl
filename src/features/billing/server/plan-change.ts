import "server-only";
import Stripe from "stripe";
import { HttpError } from "@/shared/lib/http-error";
import {
  isPersonalPaidPlan,
  PERSONAL_PLAN_NAMES,
  personalPlanRank,
  type PersonalPaidPlan,
} from "../plans";
import {
  getStripe,
  isStripeConfigured,
  personalPlanPriceEnv,
  personalPlanPriceId,
  selectSeatItem,
} from "./stripe";
import {
  liveScheduleFor,
  NO_SCHEDULED_CHANGE,
  releaseScheduleFor,
  scheduledChangeOf,
  scheduleSwitchAtPeriodEnd,
  type ScheduledChange,
} from "./stripe-schedule";
import { derivePlan } from "./webhook-plan";
import {
  claimWorkspaceCheckout,
  getWorkspaceBilling,
  releaseWorkspaceCheckout,
  upsertWorkspaceBilling,
  type WorkspaceBillingRow,
} from "./workspace-billing";

/**
 * Switching a LIVE personal subscription between its paid tiers — Pro ⇄ Max
 * (2026-10-22). ONE subscription throughout: checkout is for a container with
 * no live subscription (`checkout/route.ts` answers 409 when there is one), and
 * this is the in-place move, the personal twin of `upgrade-to-team`.
 *
 * 🔒 **THE RULES, AND WHY THEY ARE ASYMMETRIC.**
 *   • **UPGRADE (Pro → Max) IS IMMEDIATE AND PAID NOW.** The item's price is
 *     swapped with `proration_behavior: "always_invoice"`, so Stripe invoices
 *     the prorated difference on the spot, and with `payment_behavior:
 *     "error_if_incomplete"`, so a declined card FAILS THE CALL and changes
 *     nothing (402 `PAYMENT_FAILED`) — never a Max subscription with an unpaid
 *     upgrade invoice behind it. The billing date does not move.
 *   • **DOWNGRADE (Max → Pro) WAITS FOR THE PERIOD END.** It is a Stripe
 *     subscription schedule (`./stripe-schedule.ts`): Max stays live and fully
 *     entitled until the date the customer already paid through, then the price
 *     becomes Pro with no proration. An immediate downgrade would be a refund
 *     machine — upgrade, spend 20,000 credits, downgrade the same day for a
 *     prorated credit — and would also strand a payer whose spend already
 *     exceeds the smaller allowance.
 *   • **Choosing the current plan while a downgrade is queued CANCELS it**
 *     ("Keep Max"): the schedule is released and nothing is billed.
 *
 * 🔒 **CREDITS FOLLOW FROM THE VERDICT, WITH NO TOP-UP CODE.** The personal
 * wallet's counter is keyed on the period START (`credits.ts ›
 * resolveCreditPeriod`), and neither move changes it mid-period: an upgrade
 * keeps the billing date, so the same counter is now measured against 20,000
 * — the payer keeps what they spent and gains the difference at once. A
 * downgrade lands exactly on the renewal, so the new period opens a fresh
 * counter against 5,000. Nothing here writes a credit row.
 *
 * Refused before Stripe is called: past_due (fix the card first), a plan set to
 * end (resume first — re-subscribing someone who cancelled is a charge they
 * did not ask for), no live personal subscription (use checkout), and an unset
 * price env (fail closed, never another tier's price).
 */

export type PlanChangeOutcome =
  | "upgraded"
  | "downgrade_scheduled"
  | "downgrade_canceled"
  | "unchanged";

export interface PlanChangeState extends ScheduledChange {
  /** The live personal paid plan, or null when there is none to change. */
  plan: PersonalPaidPlan | null;
}

export interface PlanChangeResult extends PlanChangeState {
  outcome: PlanChangeOutcome;
}

function livePersonalPlan(
  billing: WorkspaceBillingRow | null
): PersonalPaidPlan | null {
  const live = billing?.status === "active" || billing?.status === "past_due";
  return live && billing?.stripeSubscriptionId && isPersonalPaidPlan(billing.plan)
    ? billing.plan
    : null;
}

/**
 * What the pane shows: the live personal plan and any queued switch. A DISPLAY
 * read, so a Stripe failure degrades to "nothing pending" with a warning rather
 * than breaking the billing pane — the write path re-reads Stripe and is the
 * authority.
 */
export async function getPlanChangeState(
  workspaceId: string
): Promise<PlanChangeState> {
  const billing = await getWorkspaceBilling(workspaceId);
  const plan = livePersonalPlan(billing);
  if (!plan || !billing?.stripeSubscriptionId || !isStripeConfigured()) {
    return { plan, ...NO_SCHEDULED_CHANGE };
  }
  try {
    const subscription = await getStripe().subscriptions.retrieve(
      billing.stripeSubscriptionId
    );
    return { plan, ...scheduledChangeOf(await liveScheduleFor(subscription)) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[plan-change] Could not read the schedule for workspace ${workspaceId}: ${message}`
    );
    return { plan, ...NO_SCHEDULED_CHANGE };
  }
}

function refuse(status: number, code: string, message: string): never {
  throw new HttpError(status, code, message);
}

/** Validate the stored row; every refusal here happens before Stripe is called. */
function assertChangeable(billing: WorkspaceBillingRow | null): {
  subscriptionId: string;
} {
  if (!livePersonalPlan(billing) || !billing?.stripeSubscriptionId) {
    refuse(
      409,
      "NO_ACTIVE_SUBSCRIPTION",
      "There is no active personal plan to change. Choose a plan to subscribe instead."
    );
  }
  if (billing.status === "past_due") {
    refuse(
      409,
      "PAYMENT_PAST_DUE",
      "Your last payment didn't go through. Update your payment method, then change plans."
    );
  }
  if (billing.cancelAtPeriodEnd) {
    refuse(
      409,
      "PLAN_ENDING",
      "Your plan is set to end. Resume it first, then change plans."
    );
  }
  return { subscriptionId: billing.stripeSubscriptionId };
}

function isPaymentFailure(err: unknown): boolean {
  if (err instanceof Stripe.errors.StripeCardError) return true;
  return err instanceof Stripe.errors.StripeError && err.statusCode === 402;
}

/**
 * Move a home space's live subscription to `target`. Serialized per container
 * by the same Postgres claim checkout takes, so a double-click, or a checkout
 * racing a switch, cannot interleave two Stripe writes on one subscription.
 */
export async function changePersonalPlan(
  workspaceId: string,
  target: PersonalPaidPlan
): Promise<PlanChangeResult> {
  if (!isStripeConfigured()) {
    refuse(409, "STRIPE_NOT_CONFIGURED", "Billing is not configured in this environment.");
  }
  const targetPriceId = personalPlanPriceId(target);
  if (!targetPriceId) {
    console.error(
      `[plan-change] ${personalPlanPriceEnv(target)} is not set; refusing a switch to ${target}.`
    );
    refuse(
      503,
      "PRICE_NOT_CONFIGURED",
      `${PERSONAL_PLAN_NAMES[target]} isn't available yet. Please try again later.`
    );
  }
  const { subscriptionId } = assertChangeable(await getWorkspaceBilling(workspaceId));

  if (!(await claimWorkspaceCheckout(workspaceId))) {
    refuse(
      409,
      "PLAN_CHANGE_IN_PROGRESS",
      "A billing change is already in progress. Wait a moment and try again."
    );
  }
  try {
    return await applyChange(workspaceId, subscriptionId, target, targetPriceId);
  } finally {
    try {
      await releaseWorkspaceCheckout(workspaceId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[plan-change] Failed to release the claim for workspace ${workspaceId}: ${message}`
      );
    }
  }
}

async function applyChange(
  workspaceId: string,
  subscriptionId: string,
  target: PersonalPaidPlan,
  targetPriceId: string
): Promise<PlanChangeResult> {
  const stripe = getStripe();
  // Stripe is the authority on what is billed now — the row may lag a webhook.
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const current = derivePlan(subscription);
  const item = selectSeatItem(subscription);
  if (
    !isPersonalPaidPlan(current) ||
    !item ||
    (subscription.status !== "active" && subscription.status !== "trialing")
  ) {
    refuse(
      409,
      "NO_ACTIVE_SUBSCRIPTION",
      "There is no active personal plan to change. Choose a plan to subscribe instead."
    );
  }
  if (subscription.cancel_at_period_end) {
    refuse(409, "PLAN_ENDING", "Your plan is set to end. Resume it first, then change plans.");
  }

  const pending = scheduledChangeOf(await liveScheduleFor(subscription));

  if (target === current) {
    if (!pending.scheduledPlan) {
      return { outcome: "unchanged", plan: current, ...NO_SCHEDULED_CHANGE };
    }
    await releaseScheduleFor(subscription);
    return { outcome: "downgrade_canceled", plan: current, ...NO_SCHEDULED_CHANGE };
  }

  if (personalPlanRank(target) < personalPlanRank(current)) {
    if (pending.scheduledPlan === target) {
      return { outcome: "unchanged", plan: current, ...pending };
    }
    const change = await scheduleSwitchAtPeriodEnd({
      subscription,
      item,
      currentPlan: current,
      targetPlan: target,
      targetPriceId,
    });
    return { outcome: "downgrade_scheduled", plan: current, ...change };
  }

  // UPGRADE. A queued phase would re-apply the old price at its boundary, so
  // any schedule is released first.
  await releaseScheduleFor(subscription);
  try {
    await stripe.subscriptions.update(subscription.id, {
      items: [{ id: item.id, price: targetPriceId, quantity: 1 }],
      proration_behavior: "always_invoice",
      payment_behavior: "error_if_incomplete",
      // Same call as the price, so `derivePlan`'s metadata fallback can never
      // disagree with the price it rode in with.
      metadata: { ...subscription.metadata, plan: target },
    });
  } catch (err) {
    if (isPaymentFailure(err)) {
      refuse(
        402,
        "PAYMENT_FAILED",
        `The payment for ${PERSONAL_PLAN_NAMES[target]} didn't go through, so nothing changed. Update your payment method and try again.`
      );
    }
    throw err;
  }
  // The answer, not optimism: the authoritative `customer.subscription.updated`
  // lands seconds later with its own watermark, and this write is idempotent with
  // it. `lastStripeEventCreated` is NOT stamped here (same rule as
  // `upgrade-to-team`), or the real event would be dropped as stale.
  await upsertWorkspaceBilling(workspaceId, {
    plan: target,
    stripePriceId: targetPriceId,
    seatCount: 1,
  });
  return { outcome: "upgraded", plan: target, ...NO_SCHEDULED_CHANGE };
}
