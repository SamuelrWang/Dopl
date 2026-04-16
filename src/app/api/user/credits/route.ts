import { NextResponse } from "next/server";
import { withUserAuth } from "@/lib/auth/with-auth";
import {
  getBalance,
  grantDailyBonus,
  checkAndResetCycle,
  TIER_CREDITS,
  type SubscriptionTier,
} from "@/lib/credits";
import { getUserSubscription } from "@/lib/billing/subscriptions";

async function handleGet(
  _request: Request,
  { userId }: { userId: string }
) {
  const sub = await getUserSubscription(userId);
  const tier = (sub.tier as SubscriptionTier) || "free";

  // Check if cycle needs resetting
  await checkAndResetCycle(userId, tier, sub.subscription_period_end);

  // Grant daily bonus (idempotent)
  await grantDailyBonus(userId, tier);

  const balance = await getBalance(userId);
  const tierConfig = TIER_CREDITS[tier];

  return NextResponse.json({
    balance: balance.balance,
    cycleStart: balance.cycleStart,
    cycleEnd: balance.cycleEnd,
    cycleCreditsGranted: balance.cycleCreditsGranted,
    tier,
    monthlyCredits: tierConfig.monthly,
    dailyBonus: tierConfig.dailyBonus,
    dailyBonusAvailable: !balance.lastDailyBonus || !isSameDay(balance.lastDailyBonus),
  });
}

function isSameDay(isoDate: string): boolean {
  const d = new Date(isoDate);
  const now = new Date();
  return (
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth() === now.getUTCMonth() &&
    d.getUTCDate() === now.getUTCDate()
  );
}

export const GET = withUserAuth(handleGet);
