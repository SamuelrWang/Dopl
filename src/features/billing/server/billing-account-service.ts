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
import {
  getDefaultPaymentMethod,
  isStripeConfigured,
  listCustomerInvoices,
  setSubscriptionCancelAtPeriodEnd,
} from "./stripe";
import {
  getWorkspaceBilling,
  upsertWorkspaceBilling,
  type WorkspaceBillingRow,
} from "./workspace-billing";

/**
 * The workspace's Stripe ACCOUNT — card on file, invoice history, and the
 * cancel/resume switch. Business logic between the three routes and the two
 * data sources (`./stripe.ts` for Stripe, `./workspace-billing.ts` for us).
 *
 * ONE GUARD, SPELLED ONCE: none of this is reachable without a Stripe secret
 * key AND a `stripe_customer_id` on the workspace. Both reads answer EMPTY on
 * that path — null card, no invoices — because "this workspace has never paid"
 * is a state, not a failure, and the panes render nothing for it. Only the
 * WRITE refuses, because there is nothing to cancel.
 *
 * DTOs ARE CAMELCASE AND SHAPED HERE (§2). No `snake_case` Stripe key escapes
 * this module, and no route reaches for the Stripe SDK.
 */

/** The customer id, or null when this workspace has no Stripe account to read
 *  (never subscribed, or no key configured in this environment). */
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
  // A non-card default (SEPA debit, a bank account) has no brand/last4 pair to
  // render. Answering null puts the pane in its "no card on file" state, which
  // points at the portal — the surface that CAN render every method type.
  if (!card) return null;
  return {
    brand: card.brand ?? "card",
    last4: card.last4 ?? "••••",
    expMonth: card.exp_month ?? 0,
    expYear: card.exp_year ?? 0,
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
    // `id` is optional in Stripe's type (an unsaved draft has none); an invoice
    // that came back from `list` always has one, and the fallback keeps the
    // React key honest rather than rendering `undefined`.
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
 * Flag the workspace's subscription not to renew — or clear that flag
 * (`cancelAtPeriodEnd: false`, the RESUME path).
 *
 * THE LOCAL WRITE IS NOT OPTIMISM, IT IS THE ANSWER. Stripe echoes this back as
 * a `customer.subscription.updated` webhook, but that arrives seconds later and
 * through a different process; the user who just clicked Cancel has to be told
 * NOW when their access ends. So `workspace_billing.cancel_at_period_end` is
 * written here, immediately, and the webhook's later write is idempotent with
 * it. `lastStripeEventCreated` is deliberately NOT stamped — that watermark
 * belongs to Stripe's event stream, and stamping it here would make the real
 * event look stale and get dropped (same reasoning as `upgrade-to-team`).
 *
 * Throws `HttpError` 409 when there is no live subscription to flag: a free
 * workspace, a canceled one, or an environment with no Stripe key.
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
      "This workspace has no active subscription to cancel."
    );
  }
  if (!isStripeConfigured()) {
    throw new HttpError(
      409,
      "STRIPE_NOT_CONFIGURED",
      "Billing is not configured in this environment."
    );
  }

  await setSubscriptionCancelAtPeriodEnd(
    billing.stripeSubscriptionId,
    cancelAtPeriodEnd
  );
  await upsertWorkspaceBilling(workspaceId, { cancelAtPeriodEnd });

  return {
    cancelAtPeriodEnd,
    // The period end is OURS to report — it is already stamped by the webhook
    // that opened the subscription, and re-deriving it from the update
    // response would fork the sub-level/item-level fallback in
    // `webhook-handler.ts › subscriptionFields`.
    currentPeriodEnd: billing.currentPeriodEnd,
  };
}
