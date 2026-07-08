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

/**
 * Single-tier launch checkout: $7.99/mo Pro. No tier or interval props —
 * the backend only serves STRIPE_PRO_PRICE_ID.
 */
export function EmbeddedCheckoutForm() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchClientSecret = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
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
  }, []);

  useEffect(() => {
    setError(null);
    setLoading(true);
  }, []);

  if (error) {
    return (
      <div className="rounded-lg border border-danger/30 bg-danger/5 p-4">
        <h3 className="mb-1 text-body font-medium text-danger">
          Checkout couldn&apos;t load
        </h3>
        <p className="mb-3 text-body text-danger/90">{error}</p>
        <button
          onClick={() => {
            setError(null);
            setLoading(true);
          }}
          className="text-body text-danger underline underline-offset-2 hover:opacity-80"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div id="checkout" className="relative min-h-[200px]">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-text-muted">
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
