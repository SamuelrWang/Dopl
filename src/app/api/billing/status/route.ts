import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/lib/auth/with-auth";
import { getUserSubscription } from "@/lib/billing/subscriptions";
import { FREE_INGESTION_LIMIT } from "@/lib/config";

async function handleGet(
  _request: NextRequest,
  { userId }: { userId: string }
) {
  const sub = await getUserSubscription(userId);

  return NextResponse.json({
    tier: sub.tier,
    status: sub.status,
    ingestion_count: sub.ingestion_count,
    ingestion_limit: sub.tier === "pro" ? null : FREE_INGESTION_LIMIT,
    subscription_period_end: sub.subscription_period_end,
    has_stripe_customer: !!sub.stripe_customer_id,
  });
}

export const GET = withUserAuth(handleGet);
