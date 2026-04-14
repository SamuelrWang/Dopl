"use client";

import { useSubscription } from "@/components/billing/use-subscription";
import { Button } from "@/components/ui/button";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

export default function BillingPage() {
  const sub = useSubscription();
  const searchParams = useSearchParams();
  const [portalLoading, setPortalLoading] = useState(false);

  const justUpgraded = searchParams.get("success") === "true";
  const canceled = searchParams.get("canceled") === "true";

  async function handleUpgrade() {
    const res = await fetch("/api/billing/checkout", { method: "POST" });
    const data = await res.json();
    if (data.url) window.location.href = data.url;
  }

  async function handleManage() {
    setPortalLoading(true);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } finally {
      setPortalLoading(false);
    }
  }

  if (sub.loading) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-lg">
        <h1 className="text-xl font-medium text-text-primary mb-6">Billing</h1>
        <div className="rounded-xl bg-white/[0.03] border border-white/[0.08] p-5">
          <div className="h-20 animate-pulse bg-white/[0.04] rounded-lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-lg">
      <h1 className="text-xl font-medium text-text-primary mb-6">Billing</h1>

      {justUpgraded && (
        <div className="mb-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-4 py-3 text-sm text-emerald-400">
          Welcome to Pro! Your subscription is now active.
        </div>
      )}

      {canceled && (
        <div className="mb-4 rounded-lg bg-amber-500/10 border border-amber-500/20 px-4 py-3 text-sm text-amber-400">
          Checkout was canceled. No charges were made.
        </div>
      )}

      <div className="rounded-xl bg-white/[0.03] border border-white/[0.08] p-5 space-y-5">
        {/* Current Plan */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-text-secondary">Current plan</p>
            <p className="text-lg font-medium text-text-primary">
              {sub.isPro ? (
                <>
                  Pro{" "}
                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-normal">
                    Active
                  </span>
                </>
              ) : (
                "Free"
              )}
            </p>
          </div>
          {sub.isPro && sub.subscription_period_end && (
            <p className="text-xs text-text-tertiary">
              Renews{" "}
              {new Date(sub.subscription_period_end).toLocaleDateString()}
            </p>
          )}
        </div>

        {/* Usage */}
        <div className="border-t border-white/[0.06] pt-4">
          <p className="text-sm text-text-secondary mb-2">Ingestion usage</p>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-text-primary">
              {sub.ingestion_count}
            </span>
            {sub.ingestion_limit && (
              <span className="text-sm text-text-tertiary">
                / {sub.ingestion_limit} free ingestions
              </span>
            )}
            {sub.isPro && (
              <span className="text-sm text-text-tertiary">
                ingestions (unlimited)
              </span>
            )}
          </div>
          {!sub.isPro && sub.ingestion_limit && (
            <div className="mt-2 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{
                  width: `${Math.min(
                    100,
                    (sub.ingestion_count / sub.ingestion_limit) * 100
                  )}%`,
                }}
              />
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="border-t border-white/[0.06] pt-4">
          {sub.isPro ? (
            <Button
              variant="outline"
              onClick={handleManage}
              disabled={portalLoading}
              className="w-full"
            >
              {portalLoading ? "Loading..." : "Manage Subscription"}
            </Button>
          ) : (
            <div className="space-y-3">
              <div className="text-center">
                <span className="text-lg font-semibold text-text-primary">
                  $20
                </span>
                <span className="text-sm text-text-tertiary">/month</span>
              </div>
              <Button onClick={handleUpgrade} className="w-full">
                Upgrade to Pro
              </Button>
              <a
                href="/pricing"
                className="block text-xs text-text-tertiary text-center hover:text-text-secondary transition-colors underline underline-offset-2"
              >
                Compare plans in detail
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
