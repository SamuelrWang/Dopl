import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { getUserSubscription } from "@/features/billing/server/subscriptions";
import { hasActiveAccess } from "@/features/billing/server/access";

async function handleGet(
  _request: NextRequest,
  { userId }: { userId: string }
) {
  const sub = await getUserSubscription(userId);
  const access = await hasActiveAccess(userId);

  return NextResponse.json({
    // Stable shape for legacy UI consumers.
    tier: sub.tier,
    status: sub.status,
    subscription_period_end: sub.subscription_period_end,
    has_stripe_customer: !!sub.stripe_customer_id,
    // New access fields — drive the trial countdown + paywall UI.
    access: {
      allowed: access.allowed,
      reason: access.reason,
      trial_expires_at: access.trial_expires_at,
    },
  });
}

export const GET = withUserAuth(handleGet);
