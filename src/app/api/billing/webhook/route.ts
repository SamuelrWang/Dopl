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
    const ip = request.headers.get("x-forwarded-for") || "unknown";
    // Log signature failures so we can detect probing / tampering.
    console.error(
      `[webhook] Invalid Stripe signature from ${ip} at ${new Date().toISOString()}: ${message}`
    );
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // ── Two-phase idempotency ─────────────────────────────────────────
  // 1. RESERVE the event (processed=false). If this row already exists
  //    with processed=true → we already finished this event, short-circuit.
  //    If it exists with processed=false → a previous attempt crashed
  //    mid-way; retry the handler.
  // 2. Run the handler.
  // 3. COMMIT by flipping processed=true on success.
  //
  // If the handler fails, the row stays at processed=false and Stripe
  // retries the webhook until it succeeds.
  const supabase = supabaseAdmin();
  const { error: insertError } = await supabase
    .from("webhook_events")
    .insert({ event_id: event.id, event_type: event.type, processed: false });

  if (insertError && insertError.code === "23505") {
    // Row already exists — check whether it's been committed.
    const { data: existing } = await supabase
      .from("webhook_events")
      .select("processed")
      .eq("event_id", event.id)
      .single();
    if (existing?.processed) {
      console.log(`[webhook] Skipping already-processed event ${event.id}`);
      return NextResponse.json({ received: true, duplicate: true });
    }
    // processed=false means a previous attempt failed; fall through to
    // retry the handler.
    console.log(`[webhook] Retrying previously-failed event ${event.id}`);
  } else if (insertError) {
    // Any other error: fail closed so Stripe retries.
    console.error(`[webhook] Idempotency insert failed: ${insertError.message}`);
    return NextResponse.json(
      { error: "Idempotency check failed; please retry" },
      { status: 503 }
    );
  }

  // Wrap the handler so a thrown error leaves processed=false for retry,
  // and records the error for debugging.
  try {
    switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const customerId = session.customer as string;
      const subscriptionId = session.subscription as string;
      const newTier = (session.metadata?.tier as SubscriptionTier) || "pro";
      const metadataUserId = session.metadata?.userId;

      if (!metadataUserId) {
        console.error(`[webhook] checkout.session.completed missing userId metadata for event ${event.id}`);
        break;
      }

      // Link Stripe customer to user profile (this also persists the
      // customerId ↔ userId mapping).
      await updateSubscription(metadataUserId, {
        subscription_tier: newTier,
        subscription_status: "active",
        stripe_customer_id: customerId,
        stripe_subscription_id: subscriptionId,
      });

      // Cross-verify: look the user up by customer_id and confirm it matches
      // the userId in metadata. If a future webhook for this customer would
      // resolve to a different user, that's suspicious — refuse the grant.
      const resolvedUserId = await getUserByStripeCustomer(customerId);
      if (resolvedUserId && resolvedUserId !== metadataUserId) {
        console.error(
          `[webhook] userId mismatch on event ${event.id}: metadata=${metadataUserId}, customer-resolved=${resolvedUserId}. Skipping credit grant.`
        );
        break;
      }

      await handleUpgrade(metadataUserId, "free", newTier);
      break;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;
      const userId = await getUserByStripeCustomer(customerId);
      if (!userId) break;

      const status = subscription.status;
      const subTier = (subscription.metadata?.tier as SubscriptionTier) ||
        (status === "active" || status === "trialing" ? "pro" : "free");

      const periodEnd = subscription.items?.data?.[0]?.current_period_end;

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

      if (subTier !== "free" && subTier !== oldTier) {
        await handleUpgrade(userId, oldTier, subTier);
      } else if (subTier !== "free" && periodEnd) {
        const periodEndDate = new Date(periodEnd * 1000);
        const { data: credits } = await supabase
          .from("user_credits")
          .select("cycle_start")
          .eq("user_id", userId)
          .single();
        if (credits) {
          const cycleStart = new Date(credits.cycle_start);
          const daysSince = (Date.now() - cycleStart.getTime()) / (1000 * 60 * 60 * 24);
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

    // Commit: mark the event as processed so a duplicate delivery
    // short-circuits instead of re-running the handler.
    await supabase
      .from("webhook_events")
      .update({ processed: true, completed_at: new Date().toISOString() })
      .eq("event_id", event.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[webhook] Handler failed for event ${event.id}: ${message}`);
    // Record the error but leave processed=false so Stripe retries.
    await supabase
      .from("webhook_events")
      .update({ last_error: message })
      .eq("event_id", event.id);
    // Return 5xx to trigger Stripe retry.
    return NextResponse.json(
      { error: "Webhook handler failed; please retry" },
      { status: 500 }
    );
  }

  return NextResponse.json({ received: true });
}
