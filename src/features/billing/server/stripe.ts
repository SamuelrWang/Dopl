import "server-only";
import Stripe from "stripe";
import { STRIPE_SESSION_ID_TEMPLATE, billingUrl } from "../url";

/**
 * Where Stripe sends the browser back — the post-retirement billing surface
 * (`src/app/billing/[segment]/page.tsx`), not `/{segment}/canvas?billing=…`,
 * which is on the RETIRE list (docs/migration-research/
 * website-retirement-plan.md §2.3). Sessions minted today are redeemed days
 * later, so this URL has to name a page that will still be there.
 *
 * The segment is passed in wherever the caller has one — `withWorkspaceAuth`
 * hands every billing route a `workspaceSlug` + `workspacePublicId` — so the
 * return lands on the billing page for the workspace that was actually paid
 * for. Without it the bare `/billing` resolves the caller's DEFAULT workspace,
 * which for a multi-workspace user is a different workspace than the one whose
 * subscription just started.
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

/** True when a Stripe secret key is configured. Lets seat-sync / checkout
 *  no-op cleanly in test + preview environments without a live key. */
export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

/**
 * The per-seat Team price (env still named STRIPE_PRO_SEAT_PRICE_ID — the
 * live price predates the Team rename). Set by the main session; read from
 * env only. Returns null when unset so callers can degrade gracefully
 * (seat-sync no-ops; checkout surfaces a clear configuration error).
 */
export function getSeatPriceId(): string | null {
  return process.env.STRIPE_PRO_SEAT_PRICE_ID || null;
}

/**
 * The flat Solo price. May be UNSET in dev/test — returns null so callers
 * degrade gracefully exactly like `getSeatPriceId` (checkout surfaces a
 * clear config error; webhook plan mapping falls back to metadata/team).
 */
export function getSoloPriceId(): string | null {
  return process.env.STRIPE_SOLO_PRICE_ID || null;
}

/**
 * Pick the subscription item that carries the plan price. A subscription
 * may hold several items (add-ons, legacy prices), so reading
 * `items.data[0]` blindly can bill against the wrong line. Prefer the item
 * whose price is the per-seat Team price, then the flat Solo price; fall
 * back to the first item (legacy single-item $20 subs that predate both).
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
  /** Which paid plan to sell. Solo is flat (quantity forced to 1); team
   *  is per-seat at `quantity` seats. */
  plan: "solo" | "team";
  /** Seat quantity for team (= current active member count). Ignored for
   *  solo, which always checks out at quantity 1. */
  quantity: number;
  email: string;
  stripeCustomerId?: string | null;
  /** Canonical `{slug}-{publicId}` segment of the workspace being bought for,
   *  so the post-payment return lands on ITS billing page rather than the
   *  buyer's default workspace. */
  segment?: string | null;
}

/**
 * Workspace-scoped subscription checkout. Solo sells STRIPE_SOLO_PRICE_ID
 * at quantity 1 (flat); team sells STRIPE_PRO_SEAT_PRICE_ID at `quantity`
 * seats. Stamps `{ workspace_id, plan }` into both the session and
 * subscription metadata so the webhook can route the resulting
 * subscription back to its workspace and derive the plan.
 *
 * Uses `ui_mode: "elements"` (Stripe's custom-checkout mode): the session is
 * rendered natively by our own design-system PaymentElement form
 * (components/embedded-checkout.tsx) rather than a Stripe-hosted iframe. The
 * `client_secret` is returned the same way, and `return_url` still receives
 * the post-payment redirect. None of the params below are elements-mode
 * disallowed: we set no `custom_text` / `branding_settings` (disallowed) and
 * no `redirect_on_completion` (embedded-only).
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

  // Collapse rapid double-clicks into one session: the key is stable within
  // an hour for a workspace + plan + quantity, so a burst of clicks reuses
  // the same checkout, while a genuine retry next hour — or a different
  // plan, or a seat count that changed mid-hour (member joined between
  // checkout opens) — gets a fresh session instead of a cached stale one.
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
 * The customer's DEFAULT payment method — what Stripe will charge next.
 *
 * Two sources, in Stripe's own order of authority: the subscription-level
 * default (`invoice_settings.default_payment_method`, what the portal edits),
 * then the newest attached card. A customer with a card attached but no default
 * set is the normal state after an embedded checkout, so falling back is not a
 * guess — it is the same method Stripe would charge.
 *
 * Returns null for a deleted customer or one with no card at all; the caller
 * renders "no payment method on file" rather than an error.
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
    // Expanded → an object; unexpanded/absent → a string id or null. Only the
    // object carries the card, and the expand above is what makes it one.
    if (preferred && typeof preferred !== "string") return preferred;
  }
  const cards = await stripe.paymentMethods.list({
    customer: stripeCustomerId,
    type: "card",
    limit: 1,
  });
  return cards.data[0] ?? null;
}

/** The customer's most recent invoices, newest first (Stripe's own order). */
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
 * Set (or clear) Stripe's `cancel_at_period_end` on a subscription. Clearing it
 * is the RESUME path — the subscription was never canceled, it was flagged not
 * to renew, so resuming is the same call with `false` and needs no new
 * checkout.
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
