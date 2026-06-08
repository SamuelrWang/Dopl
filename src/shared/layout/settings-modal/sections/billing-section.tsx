"use client";

import { useState } from "react";
import { Button } from "@/shared/ui/button";
import { useSubscription } from "@/features/billing/components/use-subscription";
import { EmbeddedCheckoutForm } from "@/features/billing/components/embedded-checkout";
import { SectionShell } from "./section-shell";

/**
 * Access & billing section — shows the current plan and either a Stripe
 * customer-portal link (paid) or an embedded checkout (trial/expired).
 * Reuses the same hooks/components as the standalone billing page.
 */
export function BillingSection() {
  const sub = useSubscription();
  const [showCheckout, setShowCheckout] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

  async function handleManage() {
    setPortalLoading(true);
    setPortalError(null);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        throw new Error(data.error || "Failed to open billing portal");
      }
      window.location.href = data.url;
    } catch (err) {
      setPortalError(err instanceof Error ? err.message : "Failed to open billing portal");
    } finally {
      setPortalLoading(false);
    }
  }

  if (sub.loading) {
    return (
      <SectionShell title="Billing">
        <div className="h-24 rounded-lg bg-surface-raised-1 animate-pulse" />
      </SectionShell>
    );
  }

  if (showCheckout && !sub.isPaid) {
    return (
      <SectionShell title="Subscribe">
        <button
          type="button"
          onClick={() => setShowCheckout(false)}
          className="self-start text-sm text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer"
        >
          ← Back to billing
        </button>
        <EmbeddedCheckoutForm />
      </SectionShell>
    );
  }

  const planLabel = sub.isPaid ? "Pro" : sub.isTrialing ? "Free trial" : "Trial expired";

  return (
    <SectionShell title="Billing" subtitle="Manage your plan and payment">
      <div className="rounded-xl bg-surface-raised-1 border border-border-default p-5 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-text-tertiary">Current plan</p>
            <p className="text-lg font-medium text-text-primary">
              {planLabel}
              {sub.isPaid && (
                <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-normal">
                  Active
                </span>
              )}
              {sub.isTrialing && (
                <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full bg-sky-500/15 text-sky-400 font-normal">
                  Trial
                </span>
              )}
            </p>
          </div>
          {sub.isPaid && sub.subscription_period_end && (
            <p className="text-xs text-text-muted">
              Renews {new Date(sub.subscription_period_end).toLocaleDateString()}
            </p>
          )}
          {sub.isTrialing && sub.access.trial_expires_at && (
            <p className="text-xs text-text-muted">
              Ends {new Date(sub.access.trial_expires_at).toLocaleDateString()}
            </p>
          )}
        </div>

        <div className="border-t border-border-subtle pt-4">
          {portalError && (
            <div className="mb-3 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-400">
              {portalError}
            </div>
          )}
          {sub.isPaid ? (
            <Button
              variant="outline"
              onClick={handleManage}
              disabled={portalLoading}
              className="w-full"
            >
              {portalLoading ? "Loading…" : "Manage subscription"}
            </Button>
          ) : (
            <Button onClick={() => setShowCheckout(true)} className="w-full">
              {sub.isTrialing ? "Subscribe early — $7.99/mo" : "Subscribe — $7.99/mo"}
            </Button>
          )}
        </div>
      </div>
    </SectionShell>
  );
}
