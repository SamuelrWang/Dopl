import { supabaseAdmin } from "@/shared/supabase/admin";

export type SubscriptionTier = "free" | "pro" | "power";

export interface UserSubscription {
  tier: SubscriptionTier;
  status: string;
  ingestion_count: number;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_period_end: string | null;
  trial_started_at: string | null;
  trial_expires_at: string | null;
}

export async function getUserSubscription(
  userId: string
): Promise<UserSubscription> {
  const { data } = await supabaseAdmin()
    .from("profiles")
    .select(
      "subscription_tier, subscription_status, ingestion_count, stripe_customer_id, stripe_subscription_id, subscription_period_end, trial_started_at, trial_expires_at"
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
    trial_started_at: (data?.trial_started_at as string | null) ?? null,
    trial_expires_at: (data?.trial_expires_at as string | null) ?? null,
  };
}

/**
 * @deprecated Use hasActiveAccess() from lib/billing/access.ts instead.
 * Kept as a no-throw compatibility shim for a few legacy callers; returns
 * true ONLY for active Stripe subs (NOT for trialing users — callers that
 * need trial access should migrate to hasActiveAccess).
 */
export async function isProUser(userId: string): Promise<boolean> {
  return isPaidUser(userId);
}

/**
 * @deprecated Use hasActiveAccess() from lib/billing/access.ts instead.
 * Returns true only for active paid Stripe subs.
 */
export async function isPaidUser(userId: string): Promise<boolean> {
  const sub = await getUserSubscription(userId);
  return sub.status === "active";
}

export async function updateSubscription(
  userId: string,
  updates: Partial<{
    subscription_tier: SubscriptionTier;
    subscription_status: string;
    stripe_customer_id: string;
    stripe_subscription_id: string;
    subscription_period_end: string;
    trial_started_at: string;
    trial_expires_at: string;
    reactivation_email_sent_at: string;
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

/**
 * Idempotently stamp a trial window on a profile. Only sets fields if
 * trial_started_at is currently NULL. Returns true if this call actually
 * started the trial, false if the user already had one (so callers know
 * whether to log the conversion event).
 */
export async function startTrialIfNew(userId: string): Promise<boolean> {
  const supabase = supabaseAdmin();
  const now = new Date();
  const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const { data, error } = await supabase
    .from("profiles")
    .update({
      trial_started_at: now.toISOString(),
      trial_expires_at: expires.toISOString(),
      subscription_status: "trialing",
    })
    .eq("id", userId)
    .is("trial_started_at", null)
    .select("id");

  if (error) {
    console.error(`[subscriptions] startTrialIfNew failed for ${userId}: ${error.message}`);
    return false;
  }

  return !!(data && data.length > 0);
}
