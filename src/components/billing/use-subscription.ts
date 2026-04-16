"use client";

import { useEffect, useState, useCallback } from "react";

interface SubscriptionStatus {
  tier: "free" | "pro" | "power";
  status: string;
  ingestion_count: number;
  ingestion_limit: number | null;
  subscription_period_end: string | null;
  has_stripe_customer: boolean;
}

const DEFAULT_STATUS: SubscriptionStatus = {
  tier: "free",
  status: "inactive",
  ingestion_count: 0,
  ingestion_limit: 5,
  subscription_period_end: null,
  has_stripe_customer: false,
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

  const isPaid =
    (sub.tier === "pro" || sub.tier === "power") && sub.status === "active";
  // Keep isPro for backward compat (true for any paid tier)
  const isPro = isPaid;

  return { ...sub, isPro, isPaid, loading, refresh };
}
