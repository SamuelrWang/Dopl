import "server-only";
import Stripe from "stripe";
import { HttpError } from "@/shared/lib/http-error";
import { PERSONAL_PLAN_NAMES, type PersonalPaidPlan } from "../plans";
import { getStripe, selectSeatItem } from "./stripe";
import { releaseScheduleFor } from "./stripe-schedule";
import { derivePlan } from "./webhook-plan";
import { upsertWorkspaceBilling } from "./workspace-billing";

/**
 * The UPGRADE half of a personal tier switch (Pro → Max), split out of
 * `./plan-change.ts` (500-line cap) after the 2026-10-22 review. Three rules:
 *
 * 🔒 **A FRESH PERIOD, PAID IN FULL — NOT A PRORATED TOP-UP.** The item's price
 * is swapped with `billing_cycle_anchor: "now"` + `proration_behavior:
 * "always_invoice"`: Stripe invoices a full Max month minus the unused part of
 * Pro, and the billing date becomes TODAY. The personal credit counter is keyed
 * on the period START (`credits.ts › resolveCreditPeriod`), so the new period is
 * a fresh 20,000 counter. The superseded rule kept the old anchor, so a Pro user
 * upgrading on day 29 paid cents for 15,000 credits and could queue a downgrade
 * for renewal and repeat it every month.
 *
 * 🔒 **APPLIED ONLY WHEN PAID, AND 3-D SECURE CAN COMPLETE.** `payment_behavior:
 * "pending_if_incomplete"`: Stripe holds the change as a PENDING UPDATE until
 * the invoice is paid. A card that needs authentication answers
 * `requires_action` with the PaymentIntent's client secret (and the hosted
 * invoice URL for the desktop, which cannot load Stripe.js); confirming it
 * applies the update and Stripe sends the ordinary `customer.subscription.updated`.
 * A plain decline voids the invoice and answers 402 `PAYMENT_FAILED` — nothing
 * changed. Pending updates carry no metadata, so `plan` is stamped in a second
 * call once the change has applied (`finalizePersonalPlan`).
 *
 * 🔒 **A DB REFUSAL AFTER THE CHARGE IS SURFACED, NOT SWALLOWED.** If the local
 * write fails (most likely `20261121170000_workspace_billing_plan_max.sql` not
 * applied → `23514`) the payer has been charged; the answer is 500
 * `PLAN_RECORD_FAILED` saying so, logged at ERROR naming the migration.
 */

export interface PendingPayment {
  clientSecret: string | null;
  hostedInvoiceUrl: string | null;
}

export type UpgradeResult =
  | { outcome: "upgraded" }
  | { outcome: "requires_action"; payment: PendingPayment };

function iso(seconds: number | null | undefined): string | undefined {
  return seconds ? new Date(seconds * 1000).toISOString() : undefined;
}

/** Write the row from what Stripe now bills — plan, price and the NEW period. */
export async function recordLivePlan(
  workspaceId: string,
  subscription: Stripe.Subscription
): Promise<void> {
  const item = selectSeatItem(subscription);
  try {
    await upsertWorkspaceBilling(workspaceId, {
      plan: derivePlan(subscription),
      stripePriceId: item?.price?.id ?? null,
      seatCount: 1,
      ...(iso(item?.current_period_start) ? { currentPeriodStart: iso(item?.current_period_start) } : {}),
      ...(iso(item?.current_period_end) ? { currentPeriodEnd: iso(item?.current_period_end) } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[plan-change] Stripe billed subscription ${subscription.id} but the row for ` +
        `workspace ${workspaceId} could not be written (${message}). Is ` +
        `20261121170000_workspace_billing_plan_max.sql applied?`
    );
    throw new HttpError(
      500,
      "PLAN_RECORD_FAILED",
      "Your payment went through, but we couldn't update your plan yet. It will update shortly — contact support if it doesn't."
    );
  }
}

/**
 * Stamp `plan` metadata to match the price (pending updates cannot carry it) and
 * record the row. Idempotent: the "unchanged" path calls it to finish a switch
 * whose 3-D Secure step completed after the first request returned.
 */
export async function finalizePersonalPlan(
  workspaceId: string,
  subscription: Stripe.Subscription,
  plan: PersonalPaidPlan
): Promise<void> {
  let live = subscription;
  if (subscription.metadata?.plan !== plan) {
    try {
      live = await getStripe().subscriptions.update(subscription.id, {
        metadata: { ...subscription.metadata, plan },
      });
    } catch (err) {
      // The price is authoritative (`derivePlan`); a missed stamp is cosmetic.
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[plan-change] Metadata stamp failed on ${subscription.id}: ${message}`);
    }
  }
  await recordLivePlan(workspaceId, live);
}

function invoiceIdOf(subscription: Stripe.Subscription): string | null {
  const ref = subscription.latest_invoice;
  if (!ref) return null;
  return typeof ref === "string" ? ref : ref.id ?? null;
}

/**
 * A pending update's invoice: hand back the authentication step, or void it
 * and refuse. Also the answer for a retry while an earlier attempt is pending.
 */
export async function pendingPaymentFor(
  subscription: Stripe.Subscription,
  target: PersonalPaidPlan
): Promise<UpgradeResult> {
  const stripe = getStripe();
  const invoiceId = invoiceIdOf(subscription);
  const invoice = invoiceId
    ? await stripe.invoices.retrieve(invoiceId, {
        expand: ["payments.data.payment.payment_intent", "confirmation_secret"],
      })
    : null;
  const intent = invoice?.payments?.data?.[0]?.payment?.payment_intent;
  const status = intent && typeof intent === "object" ? intent.status : null;
  if (invoice && (status === "requires_action" || status === "requires_confirmation")) {
    return {
      outcome: "requires_action",
      payment: {
        clientSecret:
          (typeof intent === "object" ? intent?.client_secret : null) ??
          invoice.confirmation_secret?.client_secret ??
          null,
        hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
      },
    };
  }
  if (invoice?.id && invoice.status === "open") {
    try {
      await stripe.invoices.voidInvoice(invoice.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[plan-change] Could not void invoice ${invoice.id}: ${message}`);
    }
  }
  throw new HttpError(
    402,
    "PAYMENT_FAILED",
    `The payment for ${PERSONAL_PLAN_NAMES[target]} didn't go through, so nothing changed. Update your payment method and try again.`
  );
}

function isPaymentFailure(err: unknown): boolean {
  if (err instanceof Stripe.errors.StripeCardError) return true;
  return err instanceof Stripe.errors.StripeError && err.statusCode === 402;
}

export async function upgradeInPlace(args: {
  workspaceId: string;
  subscription: Stripe.Subscription;
  item: Stripe.SubscriptionItem;
  target: PersonalPaidPlan;
  targetPriceId: string;
}): Promise<UpgradeResult> {
  const { workspaceId, subscription, item, target, targetPriceId } = args;
  // A retry while an earlier attempt waits on authentication re-offers THAT
  // invoice rather than stacking a second pending update.
  if (subscription.pending_update) return pendingPaymentFor(subscription, target);

  // A queued phase would re-apply the old price at its boundary.
  await releaseScheduleFor(subscription);
  let updated: Stripe.Subscription;
  try {
    updated = await getStripe().subscriptions.update(subscription.id, {
      items: [{ id: item.id, price: targetPriceId, quantity: 1 }],
      billing_cycle_anchor: "now",
      proration_behavior: "always_invoice",
      payment_behavior: "pending_if_incomplete",
    });
  } catch (err) {
    if (isPaymentFailure(err)) {
      throw new HttpError(
        402,
        "PAYMENT_FAILED",
        `The payment for ${PERSONAL_PLAN_NAMES[target]} didn't go through, so nothing changed. Update your payment method and try again.`
      );
    }
    throw err;
  }
  if (updated.pending_update) return pendingPaymentFor(updated, target);
  await finalizePersonalPlan(workspaceId, updated, target);
  return { outcome: "upgraded" };
}

/**
 * What an upgrade would charge TODAY — Stripe's own preview of the exact update
 * `upgradeInPlace` makes, for the confirm dialog. Amount in the currency's
 * minor unit.
 */
export async function previewUpgradeCharge(
  subscription: Stripe.Subscription,
  item: Stripe.SubscriptionItem,
  targetPriceId: string
): Promise<{ amountDue: number; currency: string }> {
  const customer =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;
  const invoice = await getStripe().invoices.createPreview({
    customer,
    subscription: subscription.id,
    subscription_details: {
      items: [{ id: item.id, price: targetPriceId, quantity: 1 }],
      billing_cycle_anchor: "now",
      proration_behavior: "always_invoice",
    },
  });
  return { amountDue: invoice.amount_due, currency: invoice.currency };
}
