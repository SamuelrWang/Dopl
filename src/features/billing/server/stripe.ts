import "server-only";
import Stripe from "stripe";
import { STRIPE_SESSION_ID_TEMPLATE, billingUrl } from "../url";

/**
 * ⚠ Where Stripe sends the browser back: `src/app/billing/[segment]/page.tsx`,
 * NOT `/{segment}/canvas?billing=…` (RETIRE list,
 * docs/migration-research/website-retirement-plan.md §2.3). Sessions minted
 * today are redeemed days later, so this URL must name a surviving page.
 *
 * ⚠ Pass the segment whenever the caller has one (`withWorkspaceAuth` hands
 * every billing route a `workspaceSlug` + `workspacePublicId`). Without it,
 * bare `/billing` resolves the caller's DEFAULT workspace — a different one
 * than the subscription just paid for.
 */
function returnUrl(
  segment: string | null | undefined,
  intent: "success" | "return",
  sessionId?: string
): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://www.usedopl.com";
  return billingUrl(appUrl, { segment, intent, sessionId });
}

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is required");
    _stripe = new Stripe(key);
  }
  return _stripe;
}

/** Lets seat-sync / checkout no-op cleanly in test + preview without a key. */
export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

/**
 * Per-seat Team price. ⚠ Env is still named STRIPE_PRO_SEAT_PRICE_ID — the live
 * price predates the Team rename. Null when unset so callers degrade
 * (seat-sync no-ops; checkout surfaces a config error).
 */
export function getSeatPriceId(): string | null {
  return process.env.STRIPE_PRO_SEAT_PRICE_ID || null;
}

/**
 * Flat Solo price. May be UNSET in dev/test — null so callers degrade like
 * `getSeatPriceId` (checkout config error; webhook plan mapping falls back to
 * metadata/team).
 */
export function getSoloPriceId(): string | null {
  return process.env.STRIPE_SOLO_PRICE_ID || null;
}

/**
 * Pick the subscription item carrying the plan price. ⚠ A subscription may hold
 * several items (add-ons, legacy prices), so `items.data[0]` can bill the wrong
 * line. Prefer the per-seat Team price, then flat Solo; fall back to the first
 * item (legacy single-item $20 subs).
 */
export function selectSeatItem(
  subscription: Stripe.Subscription
): Stripe.SubscriptionItem | undefined {
  const items = subscription.items?.data ?? [];
  const seatPriceId = getSeatPriceId();
  if (seatPriceId) {
    const match = items.find((item) => item.price?.id === seatPriceId);
    if (match) return match;
  }
  const soloPriceId = getSoloPriceId();
  if (soloPriceId) {
    const match = items.find((item) => item.price?.id === soloPriceId);
    if (match) return match;
  }
  return items[0];
}

export interface WorkspaceCheckoutArgs {
  workspaceId: string;
  /** Solo is flat (quantity forced to 1); team is per-seat at `quantity`. */
  plan: "solo" | "team";
  /** Team seat quantity (= active member count). Ignored for solo. */
  quantity: number;
  email: string;
  stripeCustomerId?: string | null;
  /** ⚠ Canonical `{slug}-{publicId}` segment of the workspace being bought
   *  for — without it the return lands on the buyer's DEFAULT workspace. */
  segment?: string | null;
}

/**
 * Workspace-scoped subscription checkout. Solo → STRIPE_SOLO_PRICE_ID at
 * quantity 1; team → STRIPE_PRO_SEAT_PRICE_ID at `quantity` seats. ⚠ Stamps
 * `{ workspace_id, plan }` into BOTH session and subscription metadata so the
 * webhook can route the subscription back and derive the plan.
 *
 * `ui_mode: "elements"` — our own PaymentElement form, not a Stripe iframe.
 * ⚠ Elements mode disallows `custom_text` / `branding_settings`, and
 * `redirect_on_completion` is embedded-only.
 */
export async function createWorkspaceCheckoutSession(
  args: WorkspaceCheckoutArgs
): Promise<string> {
  const stripe = getStripe();

  const priceId = args.plan === "solo" ? getSoloPriceId() : getSeatPriceId();
  if (!priceId) {
    throw new Error(
      args.plan === "solo"
        ? "Solo price not configured. Set STRIPE_SOLO_PRICE_ID in env."
        : "Per-seat Team price not configured. Set STRIPE_PRO_SEAT_PRICE_ID in env."
    );
  }

  const quantity = args.plan === "solo" ? 1 : Math.max(1, args.quantity);
  const metadata = { workspace_id: args.workspaceId, plan: args.plan };
  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    ui_mode: "elements",
    mode: "subscription",
    line_items: [{ price: priceId, quantity }],
    return_url: returnUrl(args.segment, "success", STRIPE_SESSION_ID_TEMPLATE),
    metadata,
    subscription_data: {
      metadata,
    },
  };

  if (args.stripeCustomerId) {
    sessionParams.customer = args.stripeCustomerId;
  } else {
    sessionParams.customer_email = args.email;
  }

  // Collapses rapid double-clicks into one session: key stable within an hour
  // per workspace+plan+quantity. A retry next hour, a different plan, or a
  // seat count that changed mid-hour gets a fresh session.
  const hourBucket = new Date().toISOString().slice(0, 13);
  const session = await stripe.checkout.sessions.create(sessionParams, {
    idempotencyKey: `checkout:${args.workspaceId}:${args.plan}:${quantity}:${hourBucket}`,
  });
  return session.client_secret!;
}

export async function createPortalSession(
  stripeCustomerId: string,
  segment?: string | null
): Promise<string> {
  const stripe = getStripe();

  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: returnUrl(segment, "return"),
  });

  return session.url;
}

/**
 * Customer's DEFAULT payment method. Two sources in Stripe's order of
 * authority: `invoice_settings.default_payment_method` (what the portal edits),
 * then the newest attached card — a card with no default set is the normal
 * state after an embedded checkout. Null for a deleted/cardless customer.
 */
export async function getDefaultPaymentMethod(
  stripeCustomerId: string
): Promise<Stripe.PaymentMethod | null> {
  const stripe = getStripe();
  const customer = await stripe.customers.retrieve(stripeCustomerId, {
    expand: ["invoice_settings.default_payment_method"],
  });
  if (!customer.deleted) {
    const preferred = customer.invoice_settings?.default_payment_method;
    // Expanded → object (carries the card); unexpanded/absent → string id or
    // null. The expand above is what makes it an object.
    if (preferred && typeof preferred !== "string") return preferred;
  }
  const cards = await stripe.paymentMethods.list({
    customer: stripeCustomerId,
    type: "card",
    limit: 1,
  });
  return cards.data[0] ?? null;
}

/** Most recent invoices, newest first (Stripe's own order). */
export async function listCustomerInvoices(
  stripeCustomerId: string,
  limit: number
): Promise<Stripe.Invoice[]> {
  const stripe = getStripe();
  const invoices = await stripe.invoices.list({
    customer: stripeCustomerId,
    limit,
  });
  return invoices.data;
}

/**
 * Set (or clear) Stripe's `cancel_at_period_end`. Clearing is the RESUME path:
 * the sub was never canceled, only flagged not to renew, so no new checkout.
 */
export async function setSubscriptionCancelAtPeriodEnd(
  stripeSubscriptionId: string,
  cancelAtPeriodEnd: boolean
): Promise<Stripe.Subscription> {
  const stripe = getStripe();
  return stripe.subscriptions.update(stripeSubscriptionId, {
    cancel_at_period_end: cancelAtPeriodEnd,
  });
}

export function constructWebhookEvent(
  body: string,
  signature: string
): Stripe.Event {
  const stripe = getStripe();
  return stripe.webhooks.constructEvent(
    body,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET!
  );
}
