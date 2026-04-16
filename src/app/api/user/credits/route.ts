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
import { supabaseAdmin } from "@/lib/supabase";

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

  // One extra read so the client can decide whether to show the early-
  // supporter congrats modal. Cheap (single column, primary-key lookup) and
  // tolerated to fail (returns null if column doesn't exist yet pre-migration).
  let earlySupporterGrantedAt: string | null = null;
  try {
    const { data } = await supabaseAdmin()
      .from("profiles")
      .select("early_supporter_granted_at")
      .eq("id", userId)
      .single();
    earlySupporterGrantedAt = data?.early_supporter_granted_at ?? null;
  } catch {
    // Column may not exist yet if migration hasn't been applied — treat as null.
  }

  return NextResponse.json({
    balance: balance.balance,
    cycleStart: balance.cycleStart,
    cycleEnd: balance.cycleEnd,
    cycleCreditsGranted: balance.cycleCreditsGranted,
    tier,
    monthlyCredits: tierConfig.monthly,
    dailyBonus: tierConfig.dailyBonus,
    dailyBonusAvailable: !balance.lastDailyBonus || !isSameDay(balance.lastDailyBonus),
    earlySupporterGrantedAt,
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
