import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { getUserSubscription } from "@/lib/billing/subscriptions";
import { createCheckoutSession } from "@/lib/billing/stripe";
import { supabaseAdmin } from "@/shared/supabase/admin";

async function handlePost(
  _request: NextRequest,
  { userId }: { userId: string }
) {
  const sub = await getUserSubscription(userId);

  if (sub.status === "active") {
    return NextResponse.json(
      { error: "Already subscribed" },
      { status: 400 }
    );
  }

  // Get user email for Stripe.
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
    sub.stripe_customer_id
  );

  return NextResponse.json({ clientSecret });
}

export const POST = withUserAuth(handlePost);
