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
 * The workspace's Stripe ACCOUNT — card on file, invoice history,
 * cancel/resume. Logic between the three routes and the two data sources
 * (`./stripe.ts`, `./workspace-billing.ts`).
 *
 * ONE GUARD, SPELLED ONCE: nothing here is reachable without a Stripe secret
 * key AND a `stripe_customer_id`. Both READS answer EMPTY on that path — "never
 * paid" is a state, not a failure. Only the WRITE refuses.
 *
 * DTOs are camelCase and shaped HERE (§2): no `snake_case` Stripe key escapes
 * this module, no route reaches for the Stripe SDK.
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
    // ⚠ NULL, NOT ZERO: `0` renders "00 / 0", an expiry Stripe never reported.
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
 * ⚠ `lastStripeEventCreated` is deliberately NOT stamped — that watermark
 * belongs to Stripe's event stream, and stamping it here makes the real event
 * look stale and get dropped (same as `upgrade-to-team`).
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
    // ⚠ Already stamped by the webhook that opened the subscription;
    // re-deriving from the update response would fork the sub-level/item-level
    // fallback in `webhook-handler.ts › subscriptionFields`.
    currentPeriodEnd: billing.currentPeriodEnd,
  };
}
