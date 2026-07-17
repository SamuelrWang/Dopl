import "server-only";
import Stripe from "stripe";

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
 * The per-seat Pro price. Set by the main session; read from env only.
 * Returns null when unset so callers can degrade gracefully (seat-sync
 * no-ops; checkout surfaces a clear configuration error).
 */
export function getSeatPriceId(): string | null {
  return process.env.STRIPE_PRO_SEAT_PRICE_ID || null;
}

/**
 * Pick the subscription item that carries the per-seat Pro price. A Pro
 * subscription may hold several items (add-ons, legacy prices), so reading
 * `items.data[0]` blindly can bill against the wrong line. Prefer the item
 * whose price is `STRIPE_PRO_SEAT_PRICE_ID`; fall back to the first item
 * (legacy single-item $20 subs that predate the per-seat price).
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
  return items[0];
}

export interface WorkspaceCheckoutArgs {
  workspaceId: string;
  /** Seat quantity = current active member count. */
  quantity: number;
  email: string;
  stripeCustomerId?: string | null;
}

/**
 * Workspace-scoped, per-seat subscription checkout. Sells
 * STRIPE_PRO_SEAT_PRICE_ID at `quantity` seats and stamps the workspace
 * id into both the session and subscription metadata so the webhook can
 * route the resulting subscription back to its workspace.
 */
export async function createWorkspaceCheckoutSession(
  args: WorkspaceCheckoutArgs
): Promise<string> {
  const stripe = getStripe();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://www.usedopl.com";

  const priceId = getSeatPriceId();
  if (!priceId) {
    throw new Error(
      "Per-seat Pro price not configured. Set STRIPE_PRO_SEAT_PRICE_ID in env."
    );
  }

  const quantity = Math.max(1, args.quantity);
  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    ui_mode: "embedded_page",
    mode: "subscription",
    line_items: [{ price: priceId, quantity }],
    return_url: `${appUrl}/canvas?billing=success&session_id={CHECKOUT_SESSION_ID}`,
    metadata: { workspace_id: args.workspaceId },
    subscription_data: {
      metadata: { workspace_id: args.workspaceId },
    },
  };

  if (args.stripeCustomerId) {
    sessionParams.customer = args.stripeCustomerId;
  } else {
    sessionParams.customer_email = args.email;
  }

  // Collapse rapid double-clicks into one session: the key is stable within
  // an hour for a workspace, so a burst of clicks reuses the same checkout,
  // while a genuine retry next hour gets a fresh one.
  const hourBucket = new Date().toISOString().slice(0, 13);
  const session = await stripe.checkout.sessions.create(sessionParams, {
    idempotencyKey: `checkout:${args.workspaceId}:${hourBucket}`,
  });
  return session.client_secret!;
}

export async function createPortalSession(
  stripeCustomerId: string
): Promise<string> {
  const stripe = getStripe();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://www.usedopl.com";

  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: `${appUrl}/canvas?billing=return`,
  });

  return session.url;
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
