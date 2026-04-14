import { NextRequest, NextResponse } from "next/server";
import { constructWebhookEvent } from "@/lib/billing/stripe";
import {
  getUserByStripeCustomer,
  updateSubscription,
} from "@/lib/billing/subscriptions";
import { supabaseAdmin } from "@/lib/supabase";
import type Stripe from "stripe";

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json(
      { error: "Missing stripe-signature header" },
      { status: 400 }
    );
  }

  let event: Stripe.Event;
  try {
    event = constructWebhookEvent(body, signature);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid signature";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId;
      const customerId = session.customer as string;
      const subscriptionId = session.subscription as string;

      if (!userId) break;

      // Link Stripe customer to user profile
      await updateSubscription(userId, {
        subscription_tier: "pro",
        subscription_status: "active",
        stripe_customer_id: customerId,
        stripe_subscription_id: subscriptionId,
      });
      break;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;
      const userId = await getUserByStripeCustomer(customerId);
      if (!userId) break;

      const status = subscription.status;
      const tier =
        status === "active" || status === "trialing" ? "pro" : "free";

      // In Stripe API 2026+, period_end is on subscription items
      const periodEnd = subscription.items?.data?.[0]?.current_period_end;

      await updateSubscription(userId, {
        subscription_tier: tier,
        subscription_status:
          status === "active" || status === "trialing"
            ? "active"
            : status === "past_due"
            ? "past_due"
            : "canceled",
        ...(periodEnd
          ? { subscription_period_end: new Date(periodEnd * 1000).toISOString() }
          : {}),
      });
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;
      const userId = await getUserByStripeCustomer(customerId);
      if (!userId) break;

      await updateSubscription(userId, {
        subscription_tier: "free",
        subscription_status: "inactive",
        stripe_subscription_id: undefined,
      });
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = invoice.customer as string;
      const userId = await getUserByStripeCustomer(customerId);
      if (!userId) break;

      await updateSubscription(userId, {
        subscription_status: "past_due",
      });
      break;
    }
  }

  return NextResponse.json({ received: true });
}
