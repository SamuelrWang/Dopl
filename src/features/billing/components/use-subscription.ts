"use client";

import { useApiQuery } from "@/shared/hooks/use-api-query";

interface SubscriptionStatus {
  tier: "free" | "pro" | "power";
  status: string;
  subscription_period_end: string | null;
  has_stripe_customer: boolean;
  access: {
    allowed: boolean;
    reason: "trialing" | "paid" | "expired" | "never_started";
    trial_expires_at: string | null;
  };
}

const DEFAULT_STATUS: SubscriptionStatus = {
  tier: "free",
  status: "inactive",
  subscription_period_end: null,
  has_stripe_customer: false,
  access: { allowed: false, reason: "expired", trial_expires_at: null },
};

export function useSubscription() {
  const query = useApiQuery<SubscriptionStatus>("/api/billing/status");
  // Defaults on error, matching the old hook (billing UI degrades to
  // "free" rather than erroring).
  const sub = query.data ?? DEFAULT_STATUS;

  const isPaid = sub.status === "active";
  const isTrialing = sub.access.reason === "trialing";
  // Kept for compatibility with a few old call sites. True only for paid.
  const isPro = isPaid;

  return {
    ...sub,
    isPro,
    isPaid,
    isTrialing,
    loading: query.isPending,
    refresh: query.refetch,
  };
}
