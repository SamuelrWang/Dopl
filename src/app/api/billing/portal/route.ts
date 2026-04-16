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

  try {
    const portalUrl = await createPortalSession(sub.stripe_customer_id);
    return NextResponse.json({ url: portalUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[billing/portal] createPortalSession failed: ${message}`);
    return NextResponse.json(
      { error: "Failed to create billing portal session. Please try again." },
      { status: 500 }
    );
  }
}

export const POST = withUserAuth(handlePost);
