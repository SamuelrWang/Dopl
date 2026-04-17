"use client";

import { Suspense, useState, useEffect } from "react";
import { useSubscription } from "@/components/billing/use-subscription";
import { Button } from "@/components/ui/button";
import { useSearchParams } from "next/navigation";
import { EmbeddedCheckoutForm } from "@/components/billing/embedded-checkout";

export default function BillingPage() {
  return (
    <Suspense>
      <BillingPageInner />
    </Suspense>
  );
}

function BillingPageInner() {
  const sub = useSubscription();
  const searchParams = useSearchParams();
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);
  const [showCheckout, setShowCheckout] = useState(false);

  const sessionId = searchParams.get("session_id");
  const canceled = searchParams.get("canceled") === "true";
  const fromPortal = searchParams.get("portal") === "return";

  const [paymentStatus, setPaymentStatus] = useState<
    "loading" | "complete" | "open" | null
  >(null);

  useEffect(() => {
    if (!sessionId) return;
    setPaymentStatus("loading");
    fetch(`/api/billing/checkout/status?session_id=${sessionId}`)
      .then((r) => r.json())
      .then((data) =>
        setPaymentStatus(data.status === "complete" ? "complete" : "open")
      )
      .catch(() => setPaymentStatus(null));
  }, [sessionId]);

  useEffect(() => {
    const shouldPoll =
      fromPortal || (sessionId && paymentStatus === "complete");
    if (!shouldPoll) return;

    let attempts = 0;
    const interval = window.setInterval(() => {
      attempts += 1;
      sub.refresh();
      if (attempts >= 10) window.clearInterval(interval);
    }, 1000);

    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromPortal, sessionId, paymentStatus]);

  async function handleManage() {
    setPortalLoading(true);
    setPortalError(null);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPortalError(data.error || `Failed to open billing portal (HTTP ${res.status})`);
        return;
      }
      if (!data.url) {
        setPortalError("Billing portal returned no URL — please try again.");
        return;
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
      <div className="container mx-auto px-4 py-8 max-w-lg">
        <h1 className="text-xl font-medium text-white mb-6">Billing</h1>
        <div className="rounded-xl bg-white/[0.03] border border-white/[0.08] p-5">
          <div className="h-20 animate-pulse bg-white/[0.04] rounded-lg" />
        </div>
      </div>
    );
  }

  if (showCheckout && !sub.isPaid) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-lg">
        <button
          onClick={() => setShowCheckout(false)}
          className="text-sm text-white/50 hover:text-white/80 transition-colors mb-4"
        >
          &larr; Back to billing
        </button>
        <h1 className="text-xl font-medium text-white mb-6">Subscribe</h1>
        <EmbeddedCheckoutForm />
      </div>
    );
  }

  // Labels
  const planLabel = sub.isPaid
    ? "Pro"
    : sub.isTrialing
    ? "Free trial"
    : "Trial expired";

  return (
    <div className="container mx-auto px-4 py-8 max-w-lg">
      <h1 className="text-xl font-medium text-white mb-6">Billing</h1>

      {paymentStatus === "complete" && !sub.isPaid && (
        <div className="mb-4 rounded-lg bg-white/[0.04] border border-white/[0.08] px-4 py-3 text-sm text-white/70">
          Finalizing your subscription… this usually takes a few seconds.
        </div>
      )}

      {paymentStatus === "complete" && sub.isPaid && (
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
        {/* Plan row */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-white/60">Current plan</p>
            <p className="text-lg font-medium text-white">
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
            <p className="text-xs text-white/40">
              Renews {new Date(sub.subscription_period_end).toLocaleDateString()}
            </p>
          )}
          {sub.isTrialing && sub.access.trial_expires_at && (
            <p className="text-xs text-white/40">
              Ends {new Date(sub.access.trial_expires_at).toLocaleString()}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="border-t border-white/[0.06] pt-4">
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
              {portalLoading ? "Loading..." : "Manage Subscription"}
            </Button>
          ) : (
            <Button onClick={() => setShowCheckout(true)} className="w-full">
              {sub.isTrialing ? "Subscribe early — $7.99/mo" : "Subscribe — $7.99/mo"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
