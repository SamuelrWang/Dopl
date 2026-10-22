import "server-only";
import type Stripe from "stripe";
import { HttpError } from "@/shared/lib/http-error";
import {
  INVOICE_PAGE_SIZE,
  type CancelPlanResult,
  type InvoiceDto,
  type InvoiceStatus,
  type PaymentMethodDto,
} from "../billing-account";
import { isPersonalPaidPlan, type PersonalPaidPlan } from "../plans";
import {
  getDefaultPaymentMethod,
  getStripe,
  isStripeConfigured,
  listCustomerInvoices,
  personalPlanPriceId,
  selectSeatItem,
  setSubscriptionCancelAtPeriodEnd,
} from "./stripe";
import {
  liveScheduleFor,
  releaseScheduleFor,
  scheduledChangeOf,
  scheduleSwitchAtPeriodEnd,
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
 * The CONTAINER's Stripe ACCOUNT — card on file, invoice history,
 * cancel/resume. Logic between the three routes and the two data sources
 * (`./stripe.ts`, `./workspace-billing.ts`).
 *
 * Container, not "workspace" (2026-09-08): a home space's Pro
 * subscription is a `workspace_billing` row keyed by that container's id, so every
 * function here already worked on one. Do not add a kind filter — it would strand
 * a personal subscriber with no way to stop paying.
 *
 * One guard, spelled once: nothing here is reachable without a Stripe secret key
 * and a `stripe_customer_id`. Both reads answer empty on that path — "never paid"
 * is a state, not a failure — and only the write refuses.
 *
 * DTOs are camelCase and shaped here (§2): no `snake_case` Stripe key escapes this
 * module, no route reaches for the Stripe SDK.
 */

/** Customer id, or null when no Stripe account to read (never subscribed, or
 *  no key configured in this environment). */
function customerIdOf(billing: WorkspaceBillingRow | null): string | null {
  if (!isStripeConfigured()) return null;
  return billing?.stripeCustomerId ?? null;
}

export async function getWorkspacePaymentMethod(
  workspaceId: string
): Promise<PaymentMethodDto | null> {
  const customerId = customerIdOf(await getWorkspaceBilling(workspaceId));
  if (!customerId) return null;
  const method = await getDefaultPaymentMethod(customerId);
  return method ? toPaymentMethodDto(method) : null;
}

function toPaymentMethodDto(
  method: Stripe.PaymentMethod
): PaymentMethodDto | null {
  const card = method.card;
  // Non-card default (SEPA debit, bank account) has no brand/last4. Null puts
  // the pane in "no card on file", which points at the portal — the surface
  // that CAN render every method type.
  if (!card) return null;
  return {
    brand: card.brand ?? "card",
    last4: card.last4 ?? "••••",
    // Null, not zero: `0` renders "00 / 0", an expiry Stripe never reported.
    expMonth: card.exp_month ?? null,
    expYear: card.exp_year ?? null,
  };
}

export async function listWorkspaceInvoices(
  workspaceId: string
): Promise<InvoiceDto[]> {
  const customerId = customerIdOf(await getWorkspaceBilling(workspaceId));
  if (!customerId) return [];
  const invoices = await listCustomerInvoices(customerId, INVOICE_PAGE_SIZE);
  return invoices.map(toInvoiceDto);
}

function toInvoiceDto(invoice: Stripe.Invoice): InvoiceDto {
  return {
    // `id` optional in Stripe's type (unsaved drafts); anything from `list`
    // has one. Fallback keeps the React key honest, not `undefined`.
    id: invoice.id ?? invoice.number ?? "",
    number: invoice.number ?? null,
    created: new Date(invoice.created * 1000).toISOString(),
    amountPaid: invoice.amount_paid ?? 0,
    amountDue: invoice.amount_due ?? 0,
    currency: invoice.currency ?? "usd",
    status: (invoice.status as InvoiceStatus | null) ?? null,
    hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
  };
}

/**
 * Flag the subscription not to renew — or clear it (`cancelAtPeriodEnd: false`,
 * the RESUME path).
 *
 * Local write is the ANSWER, not optimism: Stripe's echo webhook arrives
 * seconds later in another process, but the clicker needs the end date NOW.
 * The webhook's later write is idempotent with this one.
 *
 * `lastStripeEventCreated` is deliberately not stamped — that watermark belongs to
 * Stripe's event stream, and stamping it here makes the real event look stale and
 * get dropped.
 *
 * Throws `HttpError` 409 with no live subscription to flag.
 */
export async function setWorkspaceCancelAtPeriodEnd(
  workspaceId: string,
  cancelAtPeriodEnd: boolean
): Promise<CancelPlanResult> {
  const billing = await getWorkspaceBilling(workspaceId);
  const live = billing?.status === "active" || billing?.status === "past_due";
  if (!billing?.stripeSubscriptionId || !live) {
    throw new HttpError(
      409,
      "NO_ACTIVE_SUBSCRIPTION",
      "This workspace has no active plan to cancel."
    );
  }
  if (!isStripeConfigured()) {
    throw new HttpError(
      409,
      "STRIPE_NOT_CONFIGURED",
      "Billing is not configured in this environment."
    );
  }

  // 🔒 THE SAME CLAIM CHECKOUT AND `/change-plan` TAKE (2026-10-22 review), so a
  // cancel cannot interleave its Stripe writes with a tier switch on the same
  // subscription.
  if (!(await claimWorkspaceCheckout(workspaceId))) {
    throw new HttpError(
      409,
      "PLAN_CHANGE_IN_PROGRESS",
      "A billing change is already in progress. Wait a moment and try again."
    );
  }
  try {
    let cleared: PersonalPaidPlan | null = null;
    if (cancelAtPeriodEnd) {
      cleared = await cancelReleasingSchedule(billing.stripeSubscriptionId);
    } else {
      await setSubscriptionCancelAtPeriodEnd(billing.stripeSubscriptionId, false);
    }
    await upsertWorkspaceBilling(workspaceId, { cancelAtPeriodEnd });
    return {
      cancelAtPeriodEnd,
      // Already stamped by the webhook that opened the subscription; re-deriving
      // from the update response would fork the sub-level/item-level fallback in
      // `webhook-handler.ts › subscriptionFields`.
      currentPeriodEnd: billing.currentPeriodEnd,
      ...(cleared ? { clearedScheduledPlan: cleared } : {}),
    };
  } finally {
    try {
      await releaseWorkspaceCheckout(workspaceId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[billing/cancel] Failed to release the claim for ${workspaceId}: ${message}`);
    }
  }
}

/**
 * ⚠ A CANCEL SUPERSEDES A QUEUED MAX → PRO DOWNGRADE (2026-10-22). Stripe refuses
 * a cancelation edit on a schedule-managed subscription, so the schedule is
 * released first — and if the cancel itself then FAILS, the downgrade is queued
 * again, so a failed click leaves the subscription as it found it. Returns the
 * plan of the switch it cleared (the UI says resuming does not restore it).
 */
async function cancelReleasingSchedule(
  subscriptionId: string
): Promise<PersonalPaidPlan | null> {
  const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
  const queued = scheduledChangeOf(await liveScheduleFor(subscription)).scheduledPlan;
  const released = await releaseScheduleFor(subscription);
  try {
    await setSubscriptionCancelAtPeriodEnd(subscriptionId, true);
  } catch (err) {
    if (released && queued) await restoreQueuedSwitch(subscription, queued);
    throw err;
  }
  return released ? queued : null;
}

async function restoreQueuedSwitch(
  subscription: Stripe.Subscription,
  queued: PersonalPaidPlan
): Promise<void> {
  const item = selectSeatItem(subscription);
  const current = derivePlan(subscription);
  const targetPriceId = personalPlanPriceId(queued);
  try {
    if (!item || !targetPriceId || !isPersonalPaidPlan(current)) {
      throw new Error("subscription no longer has a personal plan item");
    }
    await scheduleSwitchAtPeriodEnd({
      subscription: { ...subscription, schedule: null },
      item,
      currentPlan: current,
      targetPlan: queued,
      targetPriceId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[billing/cancel] Cancel failed after releasing the queued switch to ${queued} ` +
        `on ${subscription.id}, and it could not be re-queued: ${message}`
    );
  }
}
