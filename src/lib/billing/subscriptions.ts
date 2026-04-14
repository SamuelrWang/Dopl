import { supabaseAdmin } from "@/lib/supabase";

export type SubscriptionTier = "free" | "pro";

export interface UserSubscription {
  tier: SubscriptionTier;
  status: string;
  ingestion_count: number;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_period_end: string | null;
}

export async function getUserSubscription(
  userId: string
): Promise<UserSubscription> {
  const { data } = await supabaseAdmin()
    .from("profiles")
    .select(
      "subscription_tier, subscription_status, ingestion_count, stripe_customer_id, stripe_subscription_id, subscription_period_end"
    )
    .eq("id", userId)
    .single();

  return {
    tier: (data?.subscription_tier as SubscriptionTier) || "free",
    status: data?.subscription_status || "inactive",
    ingestion_count: data?.ingestion_count || 0,
    stripe_customer_id: data?.stripe_customer_id || null,
    stripe_subscription_id: data?.stripe_subscription_id || null,
    subscription_period_end: data?.subscription_period_end || null,
  };
}

export async function isProUser(userId: string): Promise<boolean> {
  const sub = await getUserSubscription(userId);
  return sub.tier === "pro" && sub.status === "active";
}

export async function updateSubscription(
  userId: string,
  updates: Partial<{
    subscription_tier: SubscriptionTier;
    subscription_status: string;
    stripe_customer_id: string;
    stripe_subscription_id: string;
    subscription_period_end: string;
  }>
): Promise<void> {
  await supabaseAdmin()
    .from("profiles")
    .update(updates)
    .eq("id", userId);
}

/**
 * Find user by their Stripe customer ID.
 */
export async function getUserByStripeCustomer(
  stripeCustomerId: string
): Promise<string | null> {
  const { data } = await supabaseAdmin()
    .from("profiles")
    .select("id")
    .eq("stripe_customer_id", stripeCustomerId)
    .single();

  return data?.id || null;
}
