import "server-only";
import type Stripe from "stripe";
import type { PersonalPaidPlan } from "../plans";
import { getStripe, personalPlanPriceId } from "./stripe";

/**
 * Stripe SUBSCRIPTION SCHEDULES — the one mechanism behind a personal downgrade
 * that waits for the period end (Max → Pro, 2026-10-22). Split out of
 * `./stripe.ts` (500-line cap) and kept free of business rules: which change is
 * allowed lives in `./plan-change.ts`; this file only reads and writes the
 * schedule.
 *
 * ⚠ **THE PENDING CHANGE LIVES IN STRIPE, NOT IN A COLUMN.** Nothing on
 * `workspace_billing` records it, so there is no second copy to drift: the
 * pane reads it here (`GET /api/billing/change-plan`), and when the phase
 * boundary passes Stripe swaps the price and sends the ordinary
 * `customer.subscription.updated`, which `webhook-plan.ts › derivePlan` maps by
 * PRICE like any other.
 */

/** The next phase's personal plan and when it starts, or nothing pending. */
export interface ScheduledChange {
  scheduledPlan: PersonalPaidPlan | null;
  /** ISO-8601 instant the next phase begins, or null with nothing pending. */
  effectiveAt: string | null;
}

export const NO_SCHEDULED_CHANGE: ScheduledChange = {
  scheduledPlan: null,
  effectiveAt: null,
};

/** A schedule still able to change the subscription. `released`, `canceled`
 *  and `completed` schedules no longer govern it. */
function isLiveSchedule(schedule: Stripe.SubscriptionSchedule): boolean {
  return schedule.status === "active" || schedule.status === "not_started";
}

function scheduleId(subscription: Stripe.Subscription): string | null {
  const ref = subscription.schedule;
  if (!ref) return null;
  return typeof ref === "string" ? ref : ref.id;
}

function priceIdOf(price: string | Stripe.Price | Stripe.DeletedPrice): string {
  return typeof price === "string" ? price : price.id;
}

/** Which personal plan a Stripe price id is, by the price envs — or null for a
 *  price this environment cannot name (never guessed). */
function planForPrice(priceId: string): PersonalPaidPlan | null {
  if (priceId === personalPlanPriceId("max")) return "max";
  if (priceId === personalPlanPriceId("pro")) return "pro";
  return null;
}

/** The subscription's live schedule, retrieved, or null when it has none (or
 *  only a finished one). */
export async function liveScheduleFor(
  subscription: Stripe.Subscription
): Promise<Stripe.SubscriptionSchedule | null> {
  const id = scheduleId(subscription);
  if (!id) return null;
  const schedule =
    typeof subscription.schedule === "object" && subscription.schedule
      ? subscription.schedule
      : await getStripe().subscriptionSchedules.retrieve(id);
  return isLiveSchedule(schedule) ? schedule : null;
}

/**
 * The change a schedule has queued: the first phase that starts at or after
 * the current phase's end. A phase whose price this environment cannot name is
 * reported as nothing pending rather than as a guess.
 */
export function scheduledChangeOf(
  schedule: Stripe.SubscriptionSchedule | null
): ScheduledChange {
  if (!schedule) return NO_SCHEDULED_CHANGE;
  const currentEnd = schedule.current_phase?.end_date ?? null;
  const next = schedule.phases.find((phase) =>
    currentEnd === null ? phase.start_date > nowSeconds() : phase.start_date >= currentEnd
  );
  const price = next?.items[0]?.price;
  if (!next || !price) return NO_SCHEDULED_CHANGE;
  const plan = planForPrice(priceIdOf(price));
  if (!plan) return NO_SCHEDULED_CHANGE;
  return {
    scheduledPlan: plan,
    effectiveAt: new Date(next.start_date * 1000).toISOString(),
  };
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Drop any queued change and hand the subscription back to plain billing on its
 * CURRENT price. Releasing never changes what is billed today; it is how a
 * pending downgrade is cancelled, and it must run before a cancel-at-period-end
 * (Stripe refuses cancelation edits on a schedule-managed subscription) and
 * before an in-place upgrade (a later phase would otherwise undo it).
 * No-op without a live schedule.
 */
export async function releaseScheduleFor(
  subscription: Stripe.Subscription
): Promise<boolean> {
  const schedule = await liveScheduleFor(subscription);
  if (!schedule) return false;
  await getStripe().subscriptionSchedules.release(schedule.id);
  return true;
}

/**
 * Queue a switch to `targetPriceId` at the END of the current period. The
 * current phase is restated exactly as Stripe already bills it (same price,
 * same bounds), so nothing is prorated or charged today; the next phase runs
 * one month on the target price and the schedule then RELEASES, leaving an
 * ordinary subscription on the new price.
 *
 * Phase metadata stamps `plan` onto the subscription as each phase begins, so
 * `derivePlan`'s metadata fallback agrees with the price on both sides of the
 * boundary.
 */
export async function scheduleSwitchAtPeriodEnd(args: {
  subscription: Stripe.Subscription;
  item: Stripe.SubscriptionItem;
  currentPlan: PersonalPaidPlan;
  targetPlan: PersonalPaidPlan;
  targetPriceId: string;
}): Promise<ScheduledChange> {
  const stripe = getStripe();
  const { subscription, item } = args;
  const existing = await liveScheduleFor(subscription);
  const schedule =
    existing ??
    (await stripe.subscriptionSchedules.create({
      from_subscription: subscription.id,
    }));

  const start = schedule.current_phase?.start_date ?? item.current_period_start;
  const end = schedule.current_phase?.end_date ?? item.current_period_end;
  const metadata = subscription.metadata ?? {};

  const updated = await stripe.subscriptionSchedules.update(schedule.id, {
    end_behavior: "release",
    phases: [
      {
        items: [{ price: priceIdOf(item.price), quantity: 1 }],
        start_date: start,
        end_date: end,
        metadata: { ...metadata, plan: args.currentPlan },
      },
      {
        items: [{ price: args.targetPriceId, quantity: 1 }],
        duration: { interval: "month", interval_count: 1 },
        metadata: { ...metadata, plan: args.targetPlan },
        proration_behavior: "none",
      },
    ],
  });
  const change = scheduledChangeOf(updated);
  return change.scheduledPlan
    ? change
    : { scheduledPlan: args.targetPlan, effectiveAt: new Date(end * 1000).toISOString() };
}
