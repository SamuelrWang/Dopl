import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/lib/auth/with-auth";
import { getUserSubscription } from "@/lib/billing/subscriptions";
import { createCheckoutSession } from "@/lib/billing/stripe";
import { supabaseAdmin } from "@/lib/supabase";

async function handlePost(
  request: NextRequest,
  { userId }: { userId: string }
) {
  const sub = await getUserSubscription(userId);

  if (sub.tier === "pro" && sub.status === "active") {
    return NextResponse.json(
      { error: "Already subscribed to Pro" },
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

  const checkoutUrl = await createCheckoutSession(
    userId,
    profile.email,
    sub.stripe_customer_id
  );

  return NextResponse.json({ url: checkoutUrl });
}

export const POST = withUserAuth(handlePost);
