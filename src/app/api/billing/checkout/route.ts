import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/lib/auth/with-auth";
import { getUserSubscription } from "@/lib/billing/subscriptions";
import { createCheckoutSession } from "@/lib/billing/stripe";
import { supabaseAdmin } from "@/lib/supabase";

async function handlePost(
  request: NextRequest,
  { userId }: { userId: string }
) {
  // Target tier + billing interval from body. Default to Pro monthly
  // for backward compat.
  let tier: "pro" | "power" = "pro";
  let interval: "month" | "year" = "month";
  try {
    const body = await request.json().catch(() => ({}));
    if (body?.tier === "power") tier = "power";
    if (body?.interval === "year") interval = "year";
  } catch {
    // empty body is fine
  }

  const sub = await getUserSubscription(userId);

  if (sub.tier === tier && sub.status === "active") {
    return NextResponse.json(
      { error: `Already subscribed to ${tier}` },
      { status: 400 }
    );
  }

  // Get user email for Stripe
  const { data: profile } = await supabaseAdmin()
    .from("profiles")
    .select("email")
    .eq("id", userId)
    .single();

  if (!profile?.email) {
    return NextResponse.json(
      { error: "User email not found" },
      { status: 400 }
    );
  }

  const clientSecret = await createCheckoutSession(
    userId,
    profile.email,
    sub.stripe_customer_id,
    tier,
    interval
  );

  return NextResponse.json({ clientSecret });
}

export const POST = withUserAuth(handlePost);
