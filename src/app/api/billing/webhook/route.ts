import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { constructWebhookEvent } from "@/features/billing/server/stripe";
import { processStripeEvent } from "@/features/billing/server/webhook-handler";

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
    // Log signature failures so we can detect probing / tampering — but never
    // echo Stripe's raw verification error back to the caller (it can leak
    // internals / aid tampering). The client gets a static message.
    console.error(
      `[webhook] Invalid Stripe signature from ${ip} at ${new Date().toISOString()}: ${message}`
    );
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  try {
    const result = await processStripeEvent(event);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[webhook] Handler failed for event ${event.id}: ${message}`);
    return NextResponse.json(
      { error: "Webhook handler failed; please retry" },
      { status: 500 }
    );
  }
}
