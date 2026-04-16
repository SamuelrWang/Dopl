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

export async function createCheckoutSession(
  userId: string,
  email: string,
  stripeCustomerId?: string | null,
  tier: "pro" | "power" = "pro",
  interval: "month" | "year" = "month"
): Promise<string> {
  const stripe = getStripe();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://www.usedopl.com";

  // Price ID is tier + interval specific. Annual prices live in
  // STRIPE_<TIER>_ANNUAL_PRICE_ID, monthly in STRIPE_<TIER>_PRICE_ID.
  const priceId =
    interval === "year"
      ? tier === "power"
        ? process.env.STRIPE_POWER_ANNUAL_PRICE_ID
        : process.env.STRIPE_PRO_ANNUAL_PRICE_ID
      : tier === "power"
        ? process.env.STRIPE_POWER_PRICE_ID
        : process.env.STRIPE_PRO_PRICE_ID;

  if (!priceId) {
    const envVar =
      interval === "year"
        ? `STRIPE_${tier.toUpperCase()}_ANNUAL_PRICE_ID`
        : `STRIPE_${tier.toUpperCase()}_PRICE_ID`;
    throw new Error(
      `Stripe price ID not configured for tier "${tier}" (${interval}). Set ${envVar} in env.`
    );
  }

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    ui_mode: "embedded_page",
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    return_url: `${appUrl}/settings/billing?session_id={CHECKOUT_SESSION_ID}`,
    // Put tier + interval in both checkout and subscription metadata so
    // webhooks can read them on initial checkout AND on subsequent updates.
    metadata: { userId, tier, interval },
    subscription_data: {
      metadata: { userId, tier, interval },
    },
  };

  if (stripeCustomerId) {
    sessionParams.customer = stripeCustomerId;
  } else {
    sessionParams.customer_email = email;
  }

  const session = await stripe.checkout.sessions.create(sessionParams);
  return session.client_secret!;
}

export async function getCheckoutSessionStatus(sessionId: string) {
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  return {
    status: session.status,
    customer_email: session.customer_details?.email || null,
  };
}

export async function createPortalSession(
  stripeCustomerId: string
): Promise<string> {
  const stripe = getStripe();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://www.usedopl.com";

  // `?portal=return` lets the billing page detect portal exits so it can
  // poll /api/billing/status until the webhook-driven tier change lands,
  // instead of showing stale state until the user reloads.
  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: `${appUrl}/settings/billing?portal=return`,
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
