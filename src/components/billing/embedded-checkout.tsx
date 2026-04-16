"use client";

import { useCallback, useEffect, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout,
} from "@stripe/react-stripe-js";

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!
);

interface EmbeddedCheckoutFormProps {
  tier?: "pro" | "power";
  interval?: "month" | "year";
}

export function EmbeddedCheckoutForm({
  tier = "pro",
  interval = "month",
}: EmbeddedCheckoutFormProps = {}) {
  // Surface errors instead of letting Stripe's iframe hang indefinitely.
  // Without this, a failed /api/billing/checkout call (missing price ID,
  // already-subscribed conflict, etc.) gives the user a blank box.
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchClientSecret = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier, interval }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const msg = errBody.error || `Checkout failed (HTTP ${res.status})`;
        setError(msg);
        throw new Error(msg);
      }
      const data = await res.json();
      if (!data.clientSecret) {
        const msg = "Checkout server returned no session — please try again.";
        setError(msg);
        throw new Error(msg);
      }
      setLoading(false);
      return data.clientSecret;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Checkout failed";
      setError(msg);
      setLoading(false);
      throw err;
    }
  }, [tier, interval]);

  // Reset error when inputs change so retry doesn't show stale message.
  useEffect(() => {
    setError(null);
    setLoading(true);
  }, [tier, interval]);

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
        <h3 className="text-sm font-medium text-red-300 mb-1">
          Checkout couldn&apos;t load
        </h3>
        <p className="text-sm text-red-400/90 mb-3">{error}</p>
        <button
          onClick={() => {
            setError(null);
            setLoading(true);
          }}
          className="text-sm text-red-300 hover:text-red-200 underline underline-offset-2"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div id="checkout" className="relative min-h-[200px]">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-white/40">
          Loading checkout…
        </div>
      )}
      <EmbeddedCheckoutProvider
        stripe={stripePromise}
        options={{ fetchClientSecret }}
      >
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  );
}
