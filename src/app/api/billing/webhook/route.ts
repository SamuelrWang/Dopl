import { NextRequest, NextResponse } from "next/server";
import { constructWebhookEvent } from "@/lib/billing/stripe";
import {
  getUserByStripeCustomer,
  updateSubscription,
} from "@/lib/billing/subscriptions";
import { supabaseAdmin } from "@/lib/supabase";
import { handleUpgrade, grantCycleCredits, type SubscriptionTier } from "@/lib/credits";
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
      const newTier = (session.metadata?.tier as SubscriptionTier) || "pro";

      if (!userId) break;

      // Link Stripe customer to user profile
      await updateSubscription(userId, {
        subscription_tier: newTier,
        subscription_status: "active",
        stripe_customer_id: customerId,
        stripe_subscription_id: subscriptionId,
      });

      // Grant pro-rated credits for the upgrade
      await handleUpgrade(userId, "free", newTier);
      break;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;
      const userId = await getUserByStripeCustomer(customerId);
      if (!userId) break;

      const status = subscription.status;
      // Determine tier from subscription metadata or price
      const subTier = (subscription.metadata?.tier as SubscriptionTier) ||
        (status === "active" || status === "trialing" ? "pro" : "free");

      const periodEnd = subscription.items?.data?.[0]?.current_period_end;

      // Get previous tier to detect changes
      const supabase = supabaseAdmin();
      const { data: profile } = await supabase
        .from("profiles")
        .select("subscription_tier")
        .eq("id", userId)
        .single();
      const oldTier = (profile?.subscription_tier as SubscriptionTier) || "free";

      await updateSubscription(userId, {
        subscription_tier: subTier,
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

      // Handle tier upgrade or renewal credit grant
      if (subTier !== "free" && subTier !== oldTier) {
        await handleUpgrade(userId, oldTier, subTier);
      } else if (subTier !== "free" && periodEnd) {
        // Check if this is a renewal (new billing period)
        const periodEndDate = new Date(periodEnd * 1000);
        const { data: credits } = await supabase
          .from("user_credits")
          .select("cycle_start")
          .eq("user_id", userId)
          .single();
        if (credits) {
          const cycleStart = new Date(credits.cycle_start);
          const daysSince = (Date.now() - cycleStart.getTime()) / (1000 * 60 * 60 * 24);
          // If cycle is older than 25 days and period_end is in the future, it's a renewal
          if (daysSince >= 25 && periodEndDate.getTime() > Date.now()) {
            await grantCycleCredits(userId, subTier);
          }
        }
      }
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
