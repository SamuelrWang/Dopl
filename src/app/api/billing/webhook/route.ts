import { NextRequest, NextResponse } from "next/server";
import { constructWebhookEvent, getStripe } from "@/lib/billing/stripe";
import {
  getUserByStripeCustomer,
  getUserSubscription,
  updateSubscription,
} from "@/lib/billing/subscriptions";
import { supabaseAdmin } from "@/lib/supabase";
import { logConversionEvent, hasFiredEvent } from "@/lib/analytics/conversion-events";
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

  // ── Two-phase idempotency (see original file for rationale) ──
  const supabase = supabaseAdmin();
  const { error: insertError } = await supabase
    .from("webhook_events")
    .insert({ event_id: event.id, event_type: event.type, processed: false });

  if (insertError && insertError.code === "23505") {
    const { data: existing } = await supabase
      .from("webhook_events")
      .select("processed")
      .eq("event_id", event.id)
      .single();
    if (existing?.processed) {
      console.log(`[webhook] Skipping already-processed event ${event.id}`);
      return NextResponse.json({ received: true, duplicate: true });
    }
    console.log(`[webhook] Retrying previously-failed event ${event.id}`);
  } else if (insertError) {
    console.error(`[webhook] Idempotency insert failed: ${insertError.message}`);
    return NextResponse.json(
      { error: "Idempotency check failed; please retry" },
      { status: 503 }
    );
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const customerId = session.customer as string;
        const subscriptionId = session.subscription as string;
        const metadataUserId = session.metadata?.userId;

        if (!metadataUserId) {
          console.error(
            `[webhook] checkout.session.completed missing userId metadata for event ${event.id}`
          );
          break;
        }

        // Fetch subscription for current_period_end (session payload doesn't
        // carry it). Non-fatal if this fails — subscription.updated backfills.
        let periodEnd: number | undefined;
        try {
          const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
          periodEnd = subscription.items?.data?.[0]?.current_period_end;
        } catch (err) {
          console.error(
            `[webhook] Failed to fetch subscription ${subscriptionId} for period_end: ${err instanceof Error ? err.message : String(err)}`
          );
        }

        // Read prior state so we can distinguish first-time subscribe from
        // a reactivation (prior expired trial).
        const prior = await getUserSubscription(metadataUserId);
        const wasExpired = prior.status === "expired";

        await updateSubscription(metadataUserId, {
          subscription_tier: "pro",
          subscription_status: "active",
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
          ...(periodEnd
            ? { subscription_period_end: new Date(periodEnd * 1000).toISOString() }
            : {}),
        });

        // Cross-verify customer-to-user mapping.
        const resolvedUserId = await getUserByStripeCustomer(customerId);
        if (resolvedUserId && resolvedUserId !== metadataUserId) {
          console.error(
            `[webhook] userId mismatch on event ${event.id}: metadata=${metadataUserId}, customer-resolved=${resolvedUserId}.`
          );
          break;
        }

        // Conversion events: first-time `subscribed`, and `reactivated`
        // if they had previously crossed trial_expired. Idempotent via
        // hasFiredEvent check for `subscribed`.
        const alreadySubscribed = await hasFiredEvent(metadataUserId, "subscribed");
        if (!alreadySubscribed) {
          await logConversionEvent({
            userId: metadataUserId,
            eventType: "subscribed",
          });
        }
        if (wasExpired) {
          await logConversionEvent({
            userId: metadataUserId,
            eventType: "reactivated",
          });
        }
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        const userId = await getUserByStripeCustomer(customerId);
        if (!userId) break;

        const status = subscription.status;
        const periodEnd = subscription.items?.data?.[0]?.current_period_end;

        // Map Stripe status → our simplified status. "active" / "trialing"
        // at Stripe = "active" for us (we don't use Stripe trials);
        // everything else collapses to "expired".
        const mappedStatus =
          status === "active" || status === "trialing"
            ? "active"
            : "expired";

        await updateSubscription(userId, {
          subscription_tier: mappedStatus === "active" ? "pro" : "free",
          subscription_status: mappedStatus,
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
          subscription_status: "expired",
          stripe_subscription_id: undefined,
        });

        await logConversionEvent({
          userId,
          eventType: "churned",
        });
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;
        const userId = await getUserByStripeCustomer(customerId);
        if (!userId) break;

        // Simplified: treat payment failure as expired for access purposes.
        // Stripe will retry on its own schedule; if they recover, the
        // subsequent invoice.payment_succeeded flips them back to active.
        await updateSubscription(userId, {
          subscription_status: "expired",
        });
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;
        const userId = await getUserByStripeCustomer(customerId);
        if (!userId) break;

        const sub = await getUserSubscription(userId);
        if (sub.status !== "active") {
          await updateSubscription(userId, {
            subscription_tier: "pro",
            subscription_status: "active",
          });
        }
        break;
      }
    }

    // Commit idempotency.
    await supabase
      .from("webhook_events")
      .update({ processed: true, completed_at: new Date().toISOString() })
      .eq("event_id", event.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[webhook] Handler failed for event ${event.id}: ${message}`);
    await supabase
      .from("webhook_events")
      .update({ last_error: message })
      .eq("event_id", event.id);
    return NextResponse.json(
      { error: "Webhook handler failed; please retry" },
      { status: 500 }
    );
  }

  return NextResponse.json({ received: true });
}
