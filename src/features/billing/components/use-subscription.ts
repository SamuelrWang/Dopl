"use client";

import { useEffect, useState, useCallback } from "react";

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
  const [sub, setSub] = useState<SubscriptionStatus>(DEFAULT_STATUS);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/billing/status");
      if (res.ok) {
        setSub(await res.json());
      }
    } catch {
      // Keep defaults on error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const isPaid = sub.status === "active";
  const isTrialing = sub.access.reason === "trialing";
  // Kept for compatibility with a few old call sites. True only for paid.
  const isPro = isPaid;

  return { ...sub, isPro, isPaid, isTrialing, loading, refresh };
}
