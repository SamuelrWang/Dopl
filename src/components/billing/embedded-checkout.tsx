"use client";

import { useCallback } from "react";
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
  const fetchClientSecret = useCallback(async () => {
    const res = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tier, interval }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data.clientSecret;
  }, [tier, interval]);

  return (
    <div id="checkout">
      <EmbeddedCheckoutProvider
        stripe={stripePromise}
        options={{ fetchClientSecret }}
      >
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  );
}
