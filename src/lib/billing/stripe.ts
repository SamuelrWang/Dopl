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
  stripeCustomerId?: string | null
): Promise<string> {
  const stripe = getStripe();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://www.usedopl.com";

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    ui_mode: "embedded_page",
    mode: "subscription",
    line_items: [
      {
        price: process.env.STRIPE_PRO_PRICE_ID!,
        quantity: 1,
      },
    ],
    return_url: `${appUrl}/settings/billing?session_id={CHECKOUT_SESSION_ID}`,
    metadata: { userId },
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

  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: `${appUrl}/settings/billing`,
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
