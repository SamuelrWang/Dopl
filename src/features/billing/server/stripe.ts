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
}

/**
 * Workspace-scoped subscription checkout. Solo sells STRIPE_SOLO_PRICE_ID
 * at quantity 1 (flat); team sells STRIPE_PRO_SEAT_PRICE_ID at `quantity`
 * seats. Stamps `{ workspace_id, plan }` into both the session and
 * subscription metadata so the webhook can route the resulting
 * subscription back to its workspace and derive the plan.
 */
export async function createWorkspaceCheckoutSession(
  args: WorkspaceCheckoutArgs
): Promise<string> {
  const stripe = getStripe();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://www.usedopl.com";

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
    ui_mode: "embedded_page",
    mode: "subscription",
    line_items: [{ price: priceId, quantity }],
    return_url: `${appUrl}/canvas?billing=success&session_id={CHECKOUT_SESSION_ID}`,
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
