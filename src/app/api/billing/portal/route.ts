import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/lib/auth/with-auth";
import { getUserSubscription } from "@/lib/billing/subscriptions";
import { createPortalSession } from "@/lib/billing/stripe";

async function handlePost(
  _request: NextRequest,
  { userId }: { userId: string }
) {
  const sub = await getUserSubscription(userId);

  if (!sub.stripe_customer_id) {
    return NextResponse.json(
      { error: "No active subscription to manage" },
      { status: 400 }
    );
  }

  const portalUrl = await createPortalSession(sub.stripe_customer_id);
  return NextResponse.json({ url: portalUrl });
}

export const POST = withUserAuth(handlePost);
