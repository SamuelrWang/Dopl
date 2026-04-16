"use client";

import { Suspense, useState, useEffect } from "react";
import { useSubscription } from "@/components/billing/use-subscription";
import { Button } from "@/components/ui/button";
import { useSearchParams } from "next/navigation";
import { EmbeddedCheckoutForm } from "@/components/billing/embedded-checkout";

interface CreditInfo {
  balance: number;
  tier: string;
  monthlyCredits: number;
  cycleStart: string;
  cycleEnd: string;
}

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
  const [credits, setCredits] = useState<CreditInfo | null>(null);

  const sessionId = searchParams.get("session_id");
  const canceled = searchParams.get("canceled") === "true";
  const fromPortal = searchParams.get("portal") === "return";

  // Check payment status after checkout return
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

  // Webhook-driven tier change can lag the user's return by a few seconds.
  // After checkout completes OR after returning from the Stripe portal,
  // refetch /api/billing/status once per second for up to 10 seconds so the
  // "Welcome to X" banner (for checkout) and the Current plan display (for
  // portal) converge to the post-webhook state without requiring a manual
  // reload. We don't early-exit on tier change — the additional refreshes
  // are cheap and also catch subscription_period_end / status updates that
  // the first-delivered webhook might have skipped.
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
    // Intentionally depend on the trigger inputs only — including sub in
    // deps would restart the timer on every refresh and never converge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromPortal, sessionId, paymentStatus]);

  // Fetch credits
  useEffect(() => {
    fetch("/api/user/credits")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setCredits(data);
      })
      .catch(() => {});
  }, []);

  async function handleManage() {
    setPortalLoading(true);
    setPortalError(null);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      // Check status BEFORE parsing — `data.url` could be undefined on error
      // and `window.location.href = undefined` silently does nothing,
      // leaving the button stuck in its loading state.
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

  // Checkout form for free users
  if (showCheckout && !sub.isPaid) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-lg">
        <button
          onClick={() => setShowCheckout(false)}
          className="text-sm text-white/50 hover:text-white/80 transition-colors mb-4"
        >
          &larr; Back to billing
        </button>
        <h1 className="text-xl font-medium text-white mb-6">Upgrade</h1>
        <EmbeddedCheckoutForm />
      </div>
    );
  }

  const tierLabel =
    sub.tier === "power" ? "Power" : sub.tier === "pro" ? "Pro" : "Free";

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
          Welcome to {tierLabel}! Your subscription is now active.
        </div>
      )}

      {canceled && (
        <div className="mb-4 rounded-lg bg-amber-500/10 border border-amber-500/20 px-4 py-3 text-sm text-amber-400">
          Checkout was canceled. No charges were made.
        </div>
      )}

      {sub.status === "past_due" && (
        <div className="mb-4 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">
          Your payment failed. Please update your payment method to keep your{" "}
          {tierLabel} plan active.
          <button
            onClick={handleManage}
            className="underline underline-offset-2 ml-1 hover:text-red-300 transition-colors"
          >
            Update payment
          </button>
        </div>
      )}

      <div className="rounded-xl bg-white/[0.03] border border-white/[0.08] p-5 space-y-5">
        {/* Current Plan */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-white/60">Current plan</p>
            <p className="text-lg font-medium text-white">
              {tierLabel}
              {sub.isPaid && sub.status === "active" && (
                <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-normal">
                  Active
                </span>
              )}
            </p>
          </div>
          {sub.isPaid && sub.subscription_period_end && (
            <p className="text-xs text-white/40">
              Renews{" "}
              {new Date(sub.subscription_period_end).toLocaleDateString()}
            </p>
          )}
        </div>

        {/* Credits */}
        {credits && (
          <div className="border-t border-white/[0.06] pt-4">
            <p className="text-sm text-white/60 mb-2">Credits</p>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold text-white">
                {credits.balance}
              </span>
              <span className="text-sm text-white/40">
                / {credits.monthlyCredits} this cycle
              </span>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className="h-full rounded-full bg-white/30 transition-all"
                style={{
                  width: `${Math.min(
                    100,
                    (credits.balance / credits.monthlyCredits) * 100
                  )}%`,
                }}
              />
            </div>
            <p className="text-xs text-white/30 mt-1.5">
              Resets{" "}
              {new Date(credits.cycleEnd).toLocaleDateString()}
            </p>
          </div>
        )}

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
            <div className="space-y-3">
              <Button onClick={() => setShowCheckout(true)} className="w-full">
                Upgrade
              </Button>
              <a
                href="/pricing"
                className="block text-xs text-white/40 text-center hover:text-white/60 transition-colors underline underline-offset-2"
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
