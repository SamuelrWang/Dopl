import "server-only";
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
  finalizePersonalPlan,
  previewUpgradeCharge,
  upgradeInPlace,
  type PendingPayment,
} from "./plan-upgrade";
import {
  claimWorkspaceCheckout,
  getWorkspaceBilling,
  releaseWorkspaceCheckout,
  type WorkspaceBillingRow,
} from "./workspace-billing";

/**
 * Switching a LIVE personal subscription between its paid tiers — Pro ⇄ Max
 * (2026-10-22). ONE subscription throughout: checkout is for a container with
 * no live subscription (`checkout/route.ts` answers 409 when there is one), and
 * this is the in-place move, the personal twin of `upgrade-to-team`.
 *
 * 🔒 **THE RULES, AND WHY THEY ARE ASYMMETRIC.**
 *   • **UPGRADE (Pro → Max) IS IMMEDIATE, STARTS A FRESH PERIOD, AND IS
 *     APPLIED ONLY WHEN PAID** (`./plan-upgrade.ts`, 2026-10-22 review): the
 *     billing date resets to today (full Max month minus unused Pro, a fresh
 *     20,000 counter), 3-D Secure can complete (`requires_action`), and a
 *     decline changes nothing (402 `PAYMENT_FAILED`). The UI confirms the
 *     amount first (`previewPersonalUpgrade`).
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
 * 🔒 **CREDITS FOLLOW FROM THE PERIOD, WITH NO TOP-UP CODE.** The personal
 * wallet's counter is keyed on the period START (`credits.ts ›
 * resolveCreditPeriod`). An upgrade STARTS a new period (anchor reset), so it
 * opens a fresh counter against 20,000 that the payer bought a full month of; a
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
  | "requires_action"
  | "downgrade_scheduled"
  | "downgrade_canceled"
  | "unchanged";

export interface PlanChangeState extends ScheduledChange {
  /** The live personal paid plan, or null when there is none to change. */
  plan: PersonalPaidPlan | null;
}

export interface PlanChangeResult extends PlanChangeState {
  outcome: PlanChangeOutcome;
  /** Only on `requires_action`: the authentication step for the upgrade's
   *  invoice. Nothing has changed until it completes. */
  payment?: PendingPayment;
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

/**
 * Validate a switch and read Stripe's view of it — shared by the switch and the
 * preview so the two cannot disagree about what is allowed.
 */
async function resolveSwitch(workspaceId: string, target: PersonalPaidPlan) {
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
  return { subscriptionId, targetPriceId };
}

/** Stripe is the authority on what is billed now — the row may lag a webhook. */
async function liveSubscription(subscriptionId: string) {
  const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
  const current = derivePlan(subscription);
  const item = selectSeatItem(subscription);
  // Stripe says past_due while the row still says active (a webhook in flight):
  // the true answer is the dunning one, not "no plan".
  if (subscription.status === "past_due" && isPersonalPaidPlan(current)) {
    refuse(
      409,
      "PAYMENT_PAST_DUE",
      "Your last payment didn't go through. Update your payment method, then change plans."
    );
  }
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
  return { subscription, current, item };
}

/**
 * Move a home space's live subscription to `target`. Serialized per container
 * by the same Postgres claim checkout and cancel take, so a double-click, or a
 * checkout or cancel racing a switch, cannot interleave Stripe writes on one
 * subscription.
 */
export async function changePersonalPlan(
  workspaceId: string,
  target: PersonalPaidPlan
): Promise<PlanChangeResult> {
  const { subscriptionId, targetPriceId } = await resolveSwitch(workspaceId, target);
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
  const { subscription, current, item } = await liveSubscription(subscriptionId);
  const pending = scheduledChangeOf(await liveScheduleFor(subscription));

  if (target === current) {
    if (pending.scheduledPlan) {
      await releaseScheduleFor(subscription);
      return { outcome: "downgrade_canceled", plan: current, ...NO_SCHEDULED_CHANGE };
    }
    // Also how a 3-D Secure upgrade FINISHES: Stripe applied the pending update
    // after the first request returned, so stamp the metadata and the row now.
    await finalizePersonalPlan(workspaceId, subscription, current);
    return { outcome: "unchanged", plan: current, ...NO_SCHEDULED_CHANGE };
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

  const result = await upgradeInPlace({
    workspaceId,
    subscription,
    item,
    target,
    targetPriceId,
  });
  if (result.outcome === "requires_action") {
    return {
      outcome: "requires_action",
      plan: current,
      ...NO_SCHEDULED_CHANGE,
      payment: result.payment,
    };
  }
  return { outcome: "upgraded", plan: target, ...NO_SCHEDULED_CHANGE };
}

/**
 * What switching UP to `target` would charge today, for the confirm dialog.
 * Same validation as the switch; 409 `NOT_AN_UPGRADE` for any other direction,
 * which charges nothing today and needs no amount.
 */
export async function previewPersonalUpgrade(
  workspaceId: string,
  target: PersonalPaidPlan
): Promise<{ amountDue: number; currency: string }> {
  const { subscriptionId, targetPriceId } = await resolveSwitch(workspaceId, target);
  const { subscription, current, item } = await liveSubscription(subscriptionId);
  if (personalPlanRank(target) <= personalPlanRank(current)) {
    refuse(409, "NOT_AN_UPGRADE", "Only an upgrade is charged today.");
  }
  return previewUpgradeCharge(subscription, item, targetPriceId);
}

